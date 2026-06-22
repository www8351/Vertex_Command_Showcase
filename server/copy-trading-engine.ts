import { storage } from "./storage";
import { pushSystemError } from "./system-health-stream";
import {
  tradovateGetPositions,
  tradovateGetContract,
  tradovatePlaceOrder,
  tradovateGetOrders,
  tradovateFindContractByName,
  tradovateGetCashBalance,
  type TradovatePosition,
  type TradovateOrder,
} from "./tradovate-client";
import {
  topstepxGetPositions,
  topstepxPlaceOrder,
  topstepxGetOrders,
  topstepxGetLastTradePrice,
  topstepxSearchContract,
  type TopstepXPosition,
  type TopstepXOrder,
} from "./topstepx-client";
import {
  getOrCreateExecWSClient,
  getExecWSClient,
  releaseExecWSClient,
  broadcastToUser,
  type TradovateWSEvent,
  type TradovateWebSocketClient,
} from "./tradovate-websocket";
import {
  getOrCreateExecTopstepXClient,
  getExecTopstepXClient,
  releaseExecTopstepXClient,
  type TopstepXWSEvent,
  type TopstepXStreamingClient,
} from "./topstepx-streaming";
import { getTickSize, getTickSizeFromContractId } from "./futures-tick-sizes";
import { calculateRiskTelemetry } from "./equity-tick-processor";
import { recordLatency, incrementInFlightOrders, decrementInFlightOrders } from "./latency-monitor";
import {
  runRiskChecks,
  applyAdvancedSizing,
  computeSlippage,
  normalizeErrorCode,
  recordDailyLoss,
  mapOrderTypeForBroker,
} from "./copy-trading-risk-engine";
import type { CopyTradingGroup, CopyTradingFollower, CopyTradingConnection } from "@shared/copy-trading-schema";
import type { Account } from "@shared/schema";
import {
  type PositionSnapshot,
  type ProviderAuth,
  type ResolvedConnection,
  type ResolvedAccountInfo,
  SUPPORTED_COPY_PROVIDERS,
  resolveMasterConnection,
  resolveFollowerConnection,
  resolveMasterAccountInfo,
  resolveFollowerAccountInfo,
  authenticateProvider,
  getProviderPositions,
} from "./provider-core";

interface NormalizedOrder {
  id: string;
  status: string;
  filledQty: number;
  totalQty: number;
  avgPrice?: number;
}

async function fetchLiveAvailableMargin(
  follower: CopyTradingFollower,
  followerAccountInfo: ResolvedAccountInfo,
  followerAuth: ProviderAuth | null
): Promise<number | null> {
  if (!followerAuth) return followerAccountInfo.balance || null;

  try {
    if (followerAuth.providerKey === "tradovate") {
      const numericAccId = parseInt(followerAccountInfo.externalAccountId || "0");
      if (numericAccId > 0) {
        const cashBalance = await tradovateGetCashBalance(followerAuth.token, numericAccId, followerAuth.isLive || false);
        if (cashBalance && typeof cashBalance.amount === "number") {
          return cashBalance.amount;
        }
      }
    }
  } catch (marginErr: any) {
    console.warn(`[CopyEngine] Live margin fetch failed for follower ${follower.id}: ${marginErr?.message || "unknown"}`);
  }
  return followerAccountInfo.balance || null;
}

function computeDynamicDrawdownLimit(
  followerAccountInfo: ResolvedAccountInfo,
  followerAuth: ProviderAuth | null
): number | null {
  if (!followerAccountInfo.maxDrawdown) return null;

  if (followerAuth?.providerKey === "topstepx" && followerAccountInfo.size > 0) {
    const currentEquity = followerAccountInfo.balance || 0;
    const highWaterMark = Math.max(followerAccountInfo.size, currentEquity);
    return highWaterMark - (followerAccountInfo.size - followerAccountInfo.maxDrawdown);
  }

  return followerAccountInfo.maxDrawdown;
}

const lastKnownPositions = new Map<number, PositionSnapshot[]>();
const activeTimers = new Map<number, ReturnType<typeof setInterval>>();
const groupLocks = new Map<number, boolean>();
const consecutiveErrors = new Map<number, number>();
const MAX_CONSECUTIVE_ERRORS = 10;
const wsEnabledGroups = new Set<number>();
const wsGroupConnectionMap = new Map<number, number>();
const wsGroupListeners = new Map<number, Array<{ event: string; handler: (...args: any[]) => void }>>();

interface OTOChildSpec {
  contractId: string;
  action: "Buy" | "Sell";
  qty: number;
  orderType: string;
  price?: number;
  stopPrice?: number;
  tif: string;
}

interface CompositeOrderLink {
  compositeType: string;
  siblingOrderIds: string[];
  providerKey: string;
  accountSpec: string;
  externalAccountId: string;
  isLive: boolean;
  createdAt: number;
  otoChild?: OTOChildSpec;
}
const compositeOrderLinks = new Map<string, CompositeOrderLink>();

function registerCompositeLink(
  compositeType: string,
  orderIds: string[],
  providerKey: string,
  accountSpec: string,
  externalAccountId: string,
  isLive: boolean
) {
  for (const orderId of orderIds) {
    compositeOrderLinks.set(orderId, {
      compositeType,
      siblingOrderIds: orderIds.filter(id => id !== orderId),
      providerKey,
      accountSpec,
      externalAccountId,
      isLive,
      createdAt: Date.now(),
    });
  }
}

async function handleCompositeOrderFill(filledOrderId: string, authToken?: string) {
  const link = compositeOrderLinks.get(filledOrderId);
  if (!link) return;

  if (link.compositeType === "OCO") {
    for (const siblingId of link.siblingOrderIds) {
      try {
        if (link.providerKey === "tradovate" && authToken) {
          const baseUrl = link.isLive ? "https://live.tradovateapi.com/v1" : "https://demo.tradovateapi.com/v1";
          const cancelRes = await fetch(`${baseUrl}/order/cancelorder`, {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: parseInt(siblingId) }),
          });
          if (!cancelRes.ok) {
            console.warn(`[CopyEngine] OCO cancel response ${cancelRes.status} for sibling ${siblingId}`);
          }
        } else if (link.providerKey === "topstepx" && authToken) {
          const cancelRes = await fetch(`https://api.topstepx.com/api/Order/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: parseInt(siblingId) }),
          });
          if (!cancelRes.ok) {
            console.warn(`[CopyEngine] OCO cancel response ${cancelRes.status} for TopstepX sibling ${siblingId}`);
          }
        }
        console.log(`[CopyEngine] OCO: cancelled sibling order ${siblingId} after fill of ${filledOrderId}`);
      } catch (cancelErr: any) {
        console.warn(`[CopyEngine] OCO sibling cancel failed for ${siblingId}: ${cancelErr?.message || "unknown"}`);
      }
      compositeOrderLinks.delete(siblingId);
    }
  }

  if (link.compositeType === "OTO" && link.otoChild) {
    const child = link.otoChild;
    try {
      if (link.providerKey === "tradovate" && authToken) {
        const numericContractId = parseInt(child.contractId);
        const numericAccountId = parseInt(link.externalAccountId);
        await tradovatePlaceOrder(
          authToken, link.accountSpec, numericAccountId,
          numericContractId, child.action, child.qty, link.isLive,
          child.price ? "Limit" : child.stopPrice ? "Stop" : "Market",
          child.price, child.stopPrice, child.tif,
        );
        console.log(`[CopyEngine] OTO: placed child order for ${child.contractId} after parent fill`);
      } else if (link.providerKey === "topstepx" && authToken) {
        const numericAccountId = parseInt(link.externalAccountId);
        await topstepxPlaceOrder(
          authToken, numericAccountId, child.contractId, child.action, child.qty,
          child.price ? "limit" : child.stopPrice ? "stop" : "market",
          child.price, child.stopPrice, child.tif,
        );
        console.log(`[CopyEngine] OTO: placed child order for ${child.contractId} after parent fill`);
      }
    } catch (otoErr: any) {
      console.warn(`[CopyEngine] OTO child placement failed: ${otoErr?.message || "unknown"}`);
    }
  }

  compositeOrderLinks.delete(filledOrderId);
}

const FALLBACK_POLL_INTERVAL_MS = 60000;

export function startCopyEngine() {
  console.log("[CopyEngine] מתחיל מנוע קופי טריידינג...");
  pollActiveGroups();
  setInterval(pollActiveGroups, 30000);
}

async function pollActiveGroups() {
  try {
    const groups = await storage.getActiveCopyGroups();
    for (const group of groups) {
      if (!activeTimers.has(group.id)) {
        await startGroupPolling(group);
      }
    }
    for (const [groupId] of activeTimers) {
      if (!groups.find(g => g.id === groupId)) {
        stopGroupPolling(groupId);
      }
    }
  } catch (err: any) {
    console.error("[CopyEngine] שגיאה בסריקת קבוצות:", err.message);
    pushSystemError("error", "copy-engine", `Group scan error: ${err.message}`);
  }
}


interface QuoteResult {
  price: number | null;
  tickSize: number;
  quoteSource?: "market" | "fill" | "rest" | "none";
}

async function getCurrentQuotePrice(
  auth: ProviderAuth,
  contractId: string,
  masterCreds: any,
): Promise<QuoteResult> {
  try {
    if (auth.providerKey === "tradovate") {
      const numericContractId = parseInt(contractId);
      if (!numericContractId) return { price: null, tickSize: 0.25 };
      const contract = await tradovateGetContract(auth.token, numericContractId, auth.isLive || false);
      const symbolName = contract?.name || "";
      const tickSize = contract?.providerTickSize || getTickSize(symbolName) || 0.25;
      const baseUrl = auth.isLive
        ? "https://live.tradovateapi.com/v1"
        : "https://demo.tradovateapi.com/v1";
      try {
        const quoteRes = await fetch(`${baseUrl}/md/getQuote?symbol=${encodeURIComponent(symbolName)}`, {
          headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        });
        if (quoteRes.ok) {
          const quote = await quoteRes.json();
          const price = quote?.entries?.Trade?.price || quote?.entries?.Bid?.price || null;
          return { price, tickSize, quoteSource: "market" as const };
        }
      } catch (quoteErr: any) {
        console.warn(`[CopyEngine] Tradovate quote fetch failed for ${contractId}: ${quoteErr?.message || "unknown"}`);
      }
      return { price: null, tickSize };
    } else if (auth.providerKey === "topstepx") {
      const tickSize = getTickSizeFromContractId(contractId);
      const symbol = contractId.split(".").length >= 4 ? contractId.split(".")[3] : contractId;
      const numericAccountId = parseInt(masterCreds?.accountId || "0");
      if (numericAccountId > 0) {
        try {
          const fillPrice = await topstepxGetLastTradePrice(auth.token, numericAccountId, contractId);
          if (fillPrice && fillPrice > 0) {
            return { price: fillPrice, tickSize, quoteSource: "fill" as const };
          }
        } catch (fillErr: any) {
          console.warn(`[CopyEngine] TopstepX fill price lookup failed: ${fillErr?.message || "unknown"}`);
        }
      }
      const streamingClient = getExecTopstepXClient(auth.connectionId || 0);
      if (streamingClient) {
        const streamPrice = streamingClient.getPositionPrice(symbol);
        if (streamPrice && streamPrice > 0) {
          return { price: streamPrice, tickSize, quoteSource: "fill" as const };
        }
      }
      if (numericAccountId > 0) {
        try {
          const positions = await topstepxGetPositions(auth.token, numericAccountId);
          const match = positions.find(p => String(p.contractId) === contractId);
          if (match?.averagePrice) {
            return { price: match.averagePrice, tickSize, quoteSource: "rest" as const };
          }
        } catch (posErr: any) {
          console.warn(`[CopyEngine] TopstepX position price lookup failed: ${posErr?.message || "unknown"}`);
        }
      }
      return { price: null, tickSize, quoteSource: "none" as const };
    }
  } catch (err: any) {
    console.warn(`[CopyEngine] שליפת מחיר נוכחי נכשלה: ${err.message}`);
  }
  const fallbackTickSize = getTickSizeFromContractId(contractId);
  return { price: null, tickSize: fallbackTickSize };
}

interface BracketLeg {
  orderType: string;
  price?: number;
  stopPrice?: number;
  trailOffset?: number;
}

interface OrderParams {
  orderType?: string;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
  trailOffset?: number;
  bracketLegs?: BracketLeg[];
}

function buildOrderParamsForCopy(orderType: string, masterPrice: number | undefined, timeInForce: string): OrderParams {
  if (!masterPrice || masterPrice <= 0) {
    if (orderType !== "Market") {
      console.warn(`[CopyEngine] Order type ${orderType} requires price data but masterPrice unavailable — falling back to Market`);
    }
    return { orderType: "Market", timeInForce };
  }

  switch (orderType) {
    case "Limit":
      return { orderType: "Limit", limitPrice: masterPrice, timeInForce };
    case "Stop":
      return { orderType: "Stop", stopPrice: masterPrice, timeInForce };
    case "StopLimit":
      return { orderType: "StopLimit", limitPrice: masterPrice, stopPrice: masterPrice, timeInForce };
    case "TrailingStop": {
      const defaultTrailOffset = masterPrice * 0.005;
      return { orderType: "TrailingStop", trailOffset: defaultTrailOffset, timeInForce };
    }
    case "Bracket": {
      const profitTarget = masterPrice * 1.01;
      const stopLoss = masterPrice * 0.99;
      return {
        orderType: "Bracket",
        limitPrice: masterPrice,
        bracketLegs: [
          { price: profitTarget },
          { stopPrice: stopLoss },
        ],
        timeInForce,
      };
    }
    case "OCO": {
      const ocoUpper = masterPrice * 1.005;
      const ocoLower = masterPrice * 0.995;
      return {
        orderType: "OCO",
        bracketLegs: [
          { price: ocoUpper },
          { stopPrice: ocoLower },
        ],
        timeInForce,
      };
    }
    case "OTO": {
      const triggerPrice = masterPrice;
      return {
        orderType: "OTO",
        limitPrice: triggerPrice,
        bracketLegs: [
          { price: triggerPrice },
        ],
        timeInForce,
      };
    }
    case "Market":
    default:
      return { orderType: "Market", timeInForce };
  }
}

async function placeCompositeOrder(
  auth: ProviderAuth,
  accountSpec: string,
  externalAccountId: string,
  contractId: string,
  action: "Buy" | "Sell",
  qty: number,
  mapped: Record<string, any>,
  tif: string,
): Promise<NormalizedOrder> {
  const COMPOSITE_NORMALIZE: Record<string, string> = {
    bracket: "Bracket", Bracket: "Bracket",
    oco: "OCO", OCO: "OCO",
    oto: "OTO", OTO: "OTO",
  };
  const compositeType = COMPOSITE_NORMALIZE[mapped.orderType] || mapped.orderType;
  const legs = mapped.bracketLegs || [];

  const TRADOVATE_COMPOSITE_TYPES = ["Bracket", "OCO", "OTO"];
  const TOPSTEPX_COMPOSITE_TYPES = ["Bracket", "OCO", "OTO"];

  if (auth.providerKey === "tradovate") {
    if (!TRADOVATE_COMPOSITE_TYPES.includes(compositeType)) {
      throw new Error(`Tradovate does not support composite order type "${compositeType}". Supported: ${TRADOVATE_COMPOSITE_TYPES.join(", ")}`);
    }

    const numericContractId = parseInt(contractId);
    const numericAccountId = parseInt(externalAccountId);
    const entryPrice = mapped.price;
    const entryStopPrice = mapped.stopPrice;

    if (compositeType === "Bracket") {
      const entryResult = await tradovatePlaceOrder(
        auth.token, accountSpec, numericAccountId,
        numericContractId, action, qty, auth.isLive || false,
        entryPrice ? "Limit" : "Market", entryPrice, undefined, tif,
      );
      const entryId = String(entryResult.id);
      if (legs.length >= 2) {
        const reverseAction = action === "Buy" ? "Sell" : "Buy";
        try {
          if (legs[0]?.price) {
            await tradovatePlaceOrder(
              auth.token, accountSpec, numericAccountId,
              numericContractId, reverseAction, qty, auth.isLive || false,
              "Limit", legs[0].price, undefined, tif,
            );
          }
          if (legs[1]?.stopPrice) {
            await tradovatePlaceOrder(
              auth.token, accountSpec, numericAccountId,
              numericContractId, reverseAction, qty, auth.isLive || false,
              "Stop", undefined, legs[1].stopPrice, tif,
            );
          }
        } catch (bracketErr: any) {
          console.warn(`[CopyEngine] Bracket leg placement warning: ${bracketErr.message}`);
        }
      }
      return {
        id: entryId,
        status: entryResult.ordStatus === "Filled" ? "filled" : entryResult.ordStatus === "Rejected" ? "rejected" : "sent",
        filledQty: entryResult.filledQty || 0,
        totalQty: entryResult.qty || qty,
        avgPrice: entryResult.avgPx || entryResult.price,
      };
    }

    if (compositeType === "OCO" && legs.length >= 2) {
      const leg1Result = await tradovatePlaceOrder(
        auth.token, accountSpec, numericAccountId,
        numericContractId, action, qty, auth.isLive || false,
        legs[0]?.price ? "Limit" : "Stop",
        legs[0]?.price, legs[0]?.stopPrice, tif,
      );
      const ocoOrderIds: string[] = [String(leg1Result.id)];
      try {
        const leg2Result = await tradovatePlaceOrder(
          auth.token, accountSpec, numericAccountId,
          numericContractId, action, qty, auth.isLive || false,
          legs[1]?.stopPrice ? "Stop" : "Limit",
          legs[1]?.price, legs[1]?.stopPrice, tif,
        );
        ocoOrderIds.push(String(leg2Result.id));
      } catch (ocoErr: any) {
        console.warn(`[CopyEngine] OCO second leg warning: ${ocoErr.message}`);
      }
      if (ocoOrderIds.length >= 2) {
        registerCompositeLink("OCO", ocoOrderIds, "tradovate", accountSpec, externalAccountId, auth.isLive || false);
      }
      return {
        id: String(leg1Result.id),
        status: leg1Result.ordStatus === "Filled" ? "filled" : leg1Result.ordStatus === "Rejected" ? "rejected" : "sent",
        filledQty: leg1Result.filledQty || 0,
        totalQty: leg1Result.qty || qty,
        avgPrice: leg1Result.avgPx || leg1Result.price,
      };
    }

    if (compositeType === "OTO" && legs.length >= 1) {
      const parentResult = await tradovatePlaceOrder(
        auth.token, accountSpec, numericAccountId,
        numericContractId, action, qty, auth.isLive || false,
        entryPrice ? "Limit" : "Market", entryPrice, entryStopPrice, tif,
      );
      const parentId = String(parentResult.id);
      const childLeg = legs[0];
      const childAction: "Buy" | "Sell" = action === "Buy" ? "Sell" : "Buy";
      registerCompositeLink("OTO", [parentId], "tradovate", accountSpec, externalAccountId, auth.isLive || false);
      const parentLink = compositeOrderLinks.get(parentId);
      if (parentLink) {
        parentLink.otoChild = {
          contractId,
          action: childAction,
          qty,
          orderType: childLeg?.price ? "Limit" : childLeg?.stopPrice ? "Stop" : "Market",
          price: childLeg?.price,
          stopPrice: childLeg?.stopPrice,
          tif,
        };
      }
      if (parentResult.ordStatus === "Filled") {
        await handleCompositeOrderFill(parentId, auth.token);
      }
      return {
        id: parentId,
        status: parentResult.ordStatus === "Filled" ? "filled" : parentResult.ordStatus === "Rejected" ? "rejected" : "sent",
        filledQty: parentResult.filledQty || 0,
        totalQty: parentResult.qty || qty,
        avgPrice: parentResult.avgPx || parentResult.price,
      };
    }

    const fallbackResult = await tradovatePlaceOrder(
      auth.token, accountSpec, numericAccountId,
      numericContractId, action, qty, auth.isLive || false,
      "Market", undefined, undefined, tif,
    );
    return {
      id: String(fallbackResult.id),
      status: fallbackResult.ordStatus === "Filled" ? "filled" : fallbackResult.ordStatus === "Rejected" ? "rejected" : "sent",
      filledQty: fallbackResult.filledQty || 0,
      totalQty: fallbackResult.qty || qty,
      avgPrice: fallbackResult.avgPx || fallbackResult.price,
    };
  } else if (auth.providerKey === "topstepx") {
    if (!TOPSTEPX_COMPOSITE_TYPES.includes(compositeType)) {
      throw new Error(`TopstepX does not support composite order type "${compositeType}". Supported: ${TOPSTEPX_COMPOSITE_TYPES.join(", ")}`);
    }

    const numericAccountId = parseInt(externalAccountId);
    const entryPrice = mapped.price;

    if (compositeType === "Bracket") {
      const entryResult = await topstepxPlaceOrder(
        auth.token, numericAccountId, contractId, action, qty,
        entryPrice ? "limit" : "market", entryPrice, undefined, tif,
      );
      const entryId = String(entryResult.id);
      if (legs.length >= 2) {
        const reverseAction = action === "Buy" ? "Sell" : "Buy";
        try {
          if (legs[0]?.price) {
            await topstepxPlaceOrder(auth.token, numericAccountId, contractId, reverseAction, qty, "limit", legs[0].price, undefined, tif);
          }
          if (legs[1]?.stopPrice) {
            await topstepxPlaceOrder(auth.token, numericAccountId, contractId, reverseAction, qty, "stop", undefined, legs[1].stopPrice, tif);
          }
        } catch (bracketErr: any) {
          console.warn(`[CopyEngine] Bracket leg placement warning: ${bracketErr.message}`);
        }
      }
      return {
        id: entryId,
        status: entryResult.status === "filled" ? "filled" : entryResult.status === "rejected" ? "rejected" : "sent",
        filledQty: entryResult.filledQuantity || 0,
        totalQty: entryResult.quantity || qty,
        avgPrice: entryResult.price,
      };
    }

    if (compositeType === "OCO" && legs.length >= 2) {
      const leg1Result = await topstepxPlaceOrder(
        auth.token, numericAccountId, contractId, action, qty,
        legs[0]?.price ? "limit" : "stop",
        legs[0]?.price, legs[0]?.stopPrice, tif,
      );
      const tsxOcoIds: string[] = [String(leg1Result.id)];
      try {
        const leg2Result = await topstepxPlaceOrder(
          auth.token, numericAccountId, contractId, action, qty,
          legs[1]?.stopPrice ? "stop" : "limit",
          legs[1]?.price, legs[1]?.stopPrice, tif,
        );
        tsxOcoIds.push(String(leg2Result.id));
      } catch (ocoErr: any) {
        console.warn(`[CopyEngine] OCO second leg warning: ${ocoErr.message}`);
      }
      if (tsxOcoIds.length >= 2) {
        registerCompositeLink("OCO", tsxOcoIds, "topstepx", accountSpec, externalAccountId, false);
      }
      return {
        id: String(leg1Result.id),
        status: leg1Result.status === "filled" ? "filled" : leg1Result.status === "rejected" ? "rejected" : "sent",
        filledQty: leg1Result.filledQuantity || 0,
        totalQty: leg1Result.quantity || qty,
        avgPrice: leg1Result.price,
      };
    }

    if (compositeType === "OTO" && legs.length >= 1) {
      const parentResult = await topstepxPlaceOrder(
        auth.token, numericAccountId, contractId, action, qty,
        entryPrice ? "limit" : "market", entryPrice, undefined, tif,
      );
      const tsxParentId = String(parentResult.id);
      const tsxChildLeg = legs[0];
      const tsxChildAction: "Buy" | "Sell" = action === "Buy" ? "Sell" : "Buy";
      registerCompositeLink("OTO", [tsxParentId], "topstepx", accountSpec, externalAccountId, false);
      const tsxParentLink = compositeOrderLinks.get(tsxParentId);
      if (tsxParentLink) {
        tsxParentLink.otoChild = {
          contractId,
          action: tsxChildAction,
          qty,
          orderType: tsxChildLeg?.price ? "limit" : tsxChildLeg?.stopPrice ? "stop" : "market",
          price: tsxChildLeg?.price,
          stopPrice: tsxChildLeg?.stopPrice,
          tif,
        };
      }
      if (parentResult.status === "filled") {
        await handleCompositeOrderFill(tsxParentId, auth.token);
      }
      return {
        id: tsxParentId,
        status: parentResult.status === "filled" ? "filled" : parentResult.status === "rejected" ? "rejected" : "sent",
        filledQty: parentResult.filledQuantity || 0,
        totalQty: parentResult.quantity || qty,
        avgPrice: parentResult.price,
      };
    }

    const fallbackResult = await topstepxPlaceOrder(
      auth.token, numericAccountId, contractId, action, qty,
      "market", undefined, undefined, tif,
    );
    return {
      id: String(fallbackResult.id),
      status: fallbackResult.status === "filled" ? "filled" : fallbackResult.status === "rejected" ? "rejected" : "sent",
      filledQty: fallbackResult.filledQuantity || 0,
      totalQty: fallbackResult.quantity || qty,
      avgPrice: fallbackResult.price,
    };
  }

  throw new Error(`Provider ${auth.providerKey} does not support composite order type ${compositeType}`);
}

async function placeProviderOrder(
  auth: ProviderAuth,
  accountSpec: string,
  externalAccountId: string,
  contractId: string,
  action: "Buy" | "Sell",
  qty: number,
  params?: OrderParams,
): Promise<NormalizedOrder> {
  const mappingInput = {
    orderType: params?.orderType || "Market",
    limitPrice: params?.limitPrice,
    stopPrice: params?.stopPrice,
    timeInForce: params?.timeInForce,
    trailOffset: params?.trailOffset,
    bracketLegs: params?.bracketLegs,
  };
  const mapped = mapOrderTypeForBroker(auth.providerKey, mappingInput);
  const tif = params?.timeInForce || "Day";

  const compositeTypes = ["Bracket", "OCO", "OTO", "bracket", "oco", "oto"];
  if (compositeTypes.includes(mapped.orderType)) {
    return placeCompositeOrder(auth, accountSpec, externalAccountId, contractId, action, qty, mapped, tif);
  }

  if (auth.providerKey === "tradovate") {
    const numericContractId = parseInt(contractId);
    const numericAccountId = parseInt(externalAccountId);
    const validTvTypes = ["Market", "Limit", "Stop", "StopLimit", "TrailingStop"] as const;
    type TvOrderType = typeof validTvTypes[number];
    const tvOrderType: TvOrderType = (validTvTypes as readonly string[]).includes(mapped.orderType)
      ? (mapped.orderType as TvOrderType)
      : "Market";

    if ((tvOrderType === "Limit" || tvOrderType === "StopLimit") && params?.limitPrice == null) {
      throw new Error(`Order type ${tvOrderType} requires a limit price`);
    }
    if ((tvOrderType === "Stop" || tvOrderType === "StopLimit") && params?.stopPrice == null) {
      throw new Error(`Order type ${tvOrderType} requires a stop price`);
    }
    if (tvOrderType === "TrailingStop" && params?.trailOffset == null) {
      throw new Error(`Order type TrailingStop requires a trail offset`);
    }

    const result = await tradovatePlaceOrder(
      auth.token, accountSpec, numericAccountId,
      numericContractId, action, qty, auth.isLive || false,
      tvOrderType,
      params?.limitPrice,
      params?.stopPrice,
      tif,
      params?.trailOffset,
    );
    return {
      id: String(result.id),
      status: result.ordStatus === "Filled" ? "filled" : result.ordStatus === "Rejected" ? "rejected" : "sent",
      filledQty: result.filledQty || 0,
      totalQty: result.qty || qty,
      avgPrice: result.avgPx || result.price,
    };
  } else if (auth.providerKey === "topstepx") {
    const numericAccountId = parseInt(externalAccountId);
    const validTsxTypes = ["market", "limit", "stop", "stopLimit", "trailingStop"] as const;
    type TsxOrderType = typeof validTsxTypes[number];
    const tsxOrderType: TsxOrderType = (validTsxTypes as readonly string[]).includes(mapped.orderType)
      ? (mapped.orderType as TsxOrderType)
      : "market";

    if ((tsxOrderType === "limit" || tsxOrderType === "stopLimit") && params?.limitPrice == null) {
      throw new Error(`Order type ${tsxOrderType} requires a limit price`);
    }
    if ((tsxOrderType === "stop" || tsxOrderType === "stopLimit") && params?.stopPrice == null) {
      throw new Error(`Order type ${tsxOrderType} requires a stop price`);
    }
    if (tsxOrderType === "trailingStop" && params?.trailOffset == null) {
      throw new Error(`Order type trailingStop requires a trail offset`);
    }

    const result = await topstepxPlaceOrder(
      auth.token, numericAccountId, contractId, action, qty,
      tsxOrderType,
      params?.limitPrice,
      params?.stopPrice,
      tif,
      params?.trailOffset,
    );
    return {
      id: String(result.id),
      status: result.status === "filled" ? "filled" : result.status === "rejected" ? "rejected" : "sent",
      filledQty: result.filledQuantity || 0,
      totalQty: result.quantity || qty,
      avgPrice: result.price,
    };
  }
  throw new Error(`Provider ${auth.providerKey} not supported for order placement`);
}

async function getProviderOrders(
  auth: ProviderAuth,
  externalAccountId: string,
): Promise<NormalizedOrder[]> {
  if (auth.providerKey === "tradovate") {
    const numericId = parseInt(externalAccountId);
    if (!numericId) return [];
    const orders = await tradovateGetOrders(auth.token, numericId, auth.isLive || false);
    return orders.map(o => ({
      id: String(o.id),
      status: o.ordStatus === "Filled" ? "filled" : o.ordStatus === "Rejected" ? "rejected" : o.ordStatus === "Cancelled" ? "failed" : "sent",
      filledQty: o.filledQty || 0,
      totalQty: o.qty || 0,
      avgPrice: o.avgPx || o.price,
    }));
  } else if (auth.providerKey === "topstepx") {
    const numericId = parseInt(externalAccountId);
    if (!numericId) return [];
    const orders = await topstepxGetOrders(auth.token, numericId);
    return orders.map(o => ({
      id: String(o.id),
      status: o.status === "filled" ? "filled" : o.status === "rejected" ? "rejected" : "sent",
      filledQty: o.filledQuantity || 0,
      totalQty: o.quantity || 0,
      avgPrice: o.price,
    }));
  }
  return [];
}

async function initializePositionSnapshot(group: CopyTradingGroup): Promise<boolean> {
  try {
    const resolved = await resolveMasterConnection(group);
    if (!resolved) return false;

    const auth = await authenticateProvider(resolved.providerKey, resolved.creds);
    if (!auth) return false;

    const masterAccountInfo = await resolveMasterAccountInfo(group);
    const snapshots = await getProviderPositions(auth, masterAccountInfo?.externalAccountId || "0");
    lastKnownPositions.set(group.id, snapshots);
    console.log(`[CopyEngine] אותחל snapshot לקבוצה ${group.id}: ${snapshots.length} פוזיציות קיימות`);
    return true;
  } catch (err: any) {
    console.error(`[CopyEngine] שגיאה באתחול snapshot לקבוצה ${group.id}:`, err.message);
    return false;
  }
}

async function tryStartWebSocket(group: CopyTradingGroup): Promise<boolean> {
  try {
    const resolved = await resolveMasterConnection(group);
    if (!resolved) return false;

    const auth = await authenticateProvider(resolved.providerKey, resolved.creds);
    if (!auth) return false;
    auth.userId = resolved.userId;
    auth.connectionId = resolved.connectionId;

    const masterAccountInfo = await resolveMasterAccountInfo(group);
    const wsOwner = `copy-engine-group-${group.id}`;
    const storedCreds = resolved.creds;
    const providerKey = resolved.providerKey;
    const currentAuth: { value: ProviderAuth } = { value: auth };
    const masterExtId = masterAccountInfo?.externalAccountId || "0";
    const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];
    const connectionObj = { id: resolved.connectionId, userId: resolved.userId, encryptedCredentials: null };

    if (providerKey === "tradovate") {
      return await tryStartTradovateWebSocket(group, connectionObj, storedCreds, auth, masterExtId, wsOwner, storedCreds, providerKey, currentAuth, listeners);
    } else if (providerKey === "topstepx") {
      return await tryStartTopstepXStreaming(group, connectionObj, storedCreds, auth, masterExtId, wsOwner, storedCreds, currentAuth, listeners);
    }

    return false;
  } catch (err: any) {
    console.error(`[CopyEngine] Failed to start streaming for group ${group.id}:`, err.message);
    return false;
  }
}

async function tryStartTradovateWebSocket(
  group: CopyTradingGroup,
  connection: any,
  creds: any,
  auth: ProviderAuth,
  masterExtId: string,
  wsOwner: string,
  storedCreds: any,
  providerKey: string,
  currentAuth: { value: ProviderAuth },
  listeners: Array<{ event: string; handler: (...args: any[]) => void }>,
): Promise<boolean> {
  const accountId = parseInt(masterExtId);
  if (!accountId) return false;

  const isOAuth = !!creds.accessToken;
  const wsClient = getOrCreateExecWSClient({
    token: auth.token,
    isLive: auth.isLive || false,
    connectionId: connection.id,
    accountIds: [accountId],
    tokenRefreshFn: async () => {
      if (isOAuth) {
        console.warn(`[CopyEngine] OAuth token for group ${group.id} cannot be refreshed. WS will degrade to polling fallback.`);
        return null;
      }
      const refreshedAuth = await authenticateProvider(providerKey, storedCreds);
      if (refreshedAuth) currentAuth.value = refreshedAuth;
      return refreshedAuth?.token || null;
    },
    owner: wsOwner,
  });

  const positionHandler = async (event: TradovateWSEvent) => {
    if (groupLocks.get(group.id)) return;
    groupLocks.set(group.id, true);
    try {
      await handleWSPositionChange(group, event, currentAuth.value, masterExtId);
      resetConsecutiveErrors(group.id);
    } catch (err: any) {
      console.error(`[CopyEngine] WS position handler error for group ${group.id}:`, err.message);
      await handleConsecutiveError(group.id, err.message);
    } finally {
      groupLocks.set(group.id, false);
    }
  };

  const orderHandler = (event: TradovateWSEvent) => {
    broadcastToUser(connection.userId, "orderUpdate", { connectionId: connection.id, order: event.entity });
  };

  const balanceHandler = (event: TradovateWSEvent) => {
    broadcastToUser(connection.userId, "balanceUpdate", { connectionId: connection.id, balance: event.entity });
  };

  const execStateHandler = ({ newState }: { newState: string }) => {
    broadcastToUser(connection.userId, "execStateChange", { connectionId: connection.id, state: newState });
  };

  const maxReconnectHandler = () => {
    console.warn(`[CopyEngine] WebSocket max reconnect for group ${group.id}, falling back to polling`);
    wsEnabledGroups.delete(group.id);
    const groupListeners = wsGroupListeners.get(group.id);
    const wsClientRef = getExecWSClient(connection.id);
    if (wsClientRef && groupListeners) {
      for (const { event: ev, handler: h } of groupListeners) wsClientRef.removeListener(ev, h);
    }
    wsGroupListeners.delete(group.id);
    wsGroupConnectionMap.delete(group.id);
    releaseExecWSClient(connection.id, wsOwner);
    startFallbackPolling(group);
  };

  let tradovateAuthCount = wsClient.connectionState === "connected" ? 1 : 0;
  const reconnectReconcileHandler = () => {
    tradovateAuthCount++;
    if (tradovateAuthCount <= 1) return;
    console.log(`[CopyEngine] Tradovate WS reconnected for group ${group.id} — triggering sync recovery`);
    import("./reconciliation-daemon").then(({ runSyncRecovery }) => {
      runSyncRecovery().catch(err => console.error("[CopyEngine] Post-reconnect sync recovery failed:", err.message));
    });
  };

  wsClient.on("position", positionHandler);
  wsClient.on("order", orderHandler);
  wsClient.on("cashBalance", balanceHandler);
  wsClient.on("stateChange", execStateHandler);
  wsClient.on("maxReconnectReached", maxReconnectHandler);
  wsClient.on("authenticated", reconnectReconcileHandler);

  listeners.push(
    { event: "position", handler: positionHandler },
    { event: "order", handler: orderHandler },
    { event: "cashBalance", handler: balanceHandler },
    { event: "stateChange", handler: execStateHandler },
    { event: "maxReconnectReached", handler: maxReconnectHandler },
    { event: "authenticated", handler: reconnectReconcileHandler },
  );
  wsGroupListeners.set(group.id, listeners);

  wsClient.connect();
  wsEnabledGroups.add(group.id);
  wsGroupConnectionMap.set(group.id, connection.id);

  console.log(`[CopyEngine] WebSocket enabled for group "${group.name}" (${group.id}) - Tradovate master ${masterExtId}`);
  return true;
}

async function tryStartTopstepXStreaming(
  group: CopyTradingGroup,
  connection: any,
  creds: any,
  auth: ProviderAuth,
  masterExtId: string,
  wsOwner: string,
  storedCreds: any,
  currentAuth: { value: ProviderAuth },
  listeners: Array<{ event: string; handler: (...args: any[]) => void }>,
): Promise<boolean> {
  const numericAccountId = parseInt(masterExtId);
  if (!numericAccountId) return false;

  const topstepxClient = getOrCreateExecTopstepXClient({
    token: auth.token,
    connectionId: connection.id,
    accountIds: [numericAccountId],
    tokenRefreshFn: async () => {
      const refreshedAuth = await authenticateProvider("topstepx", storedCreds, true);
      if (refreshedAuth) currentAuth.value = refreshedAuth;
      return refreshedAuth?.token || null;
    },
    owner: wsOwner,
  });

  const positionHandler = async (event: TopstepXWSEvent) => {
    if (groupLocks.get(group.id)) return;
    groupLocks.set(group.id, true);
    try {
      await handleTopstepXPositionChange(group, event, currentAuth.value, masterExtId, connection);
      resetConsecutiveErrors(group.id);
    } catch (err: any) {
      console.error(`[CopyEngine] TopstepX position handler error for group ${group.id}:`, err.message);
      await handleConsecutiveError(group.id, err.message);
    } finally {
      groupLocks.set(group.id, false);
    }
  };

  const execStateHandler = ({ newState }: { newState: string }) => {
    broadcastToUser(connection.userId, "execStateChange", { connectionId: connection.id, state: newState });
  };

  const maxReconnectHandler = () => {
    console.warn(`[CopyEngine] TopstepX max reconnect for group ${group.id}, falling back to polling`);
    wsEnabledGroups.delete(group.id);
    const groupListeners = wsGroupListeners.get(group.id);
    const clientRef = getExecTopstepXClient(connection.id);
    if (clientRef && groupListeners) {
      for (const { event: ev, handler: h } of groupListeners) clientRef.removeListener(ev, h);
    }
    wsGroupListeners.delete(group.id);
    wsGroupConnectionMap.delete(group.id);
    releaseExecTopstepXClient(connection.id, wsOwner);
    startFallbackPolling(group);
  };

  let topstepxAuthCount = topstepxClient.connectionState === "connected" ? 1 : 0;
  const topstepxReconnectHandler = () => {
    topstepxAuthCount++;
    if (topstepxAuthCount <= 1) return;
    console.log(`[CopyEngine] TopstepX reconnected for group ${group.id} — triggering sync recovery`);
    import("./reconciliation-daemon").then(({ runSyncRecovery }) => {
      runSyncRecovery().catch(err => console.error("[CopyEngine] Post-reconnect sync recovery failed:", err.message));
    });
  };

  topstepxClient.on("position", positionHandler);
  topstepxClient.on("stateChange", execStateHandler);
  topstepxClient.on("maxReconnectReached", maxReconnectHandler);
  topstepxClient.on("authenticated", topstepxReconnectHandler);

  listeners.push(
    { event: "position", handler: positionHandler },
    { event: "stateChange", handler: execStateHandler },
    { event: "maxReconnectReached", handler: maxReconnectHandler },
    { event: "authenticated", handler: topstepxReconnectHandler },
  );
  wsGroupListeners.set(group.id, listeners);

  topstepxClient.connect();
  wsEnabledGroups.add(group.id);
  wsGroupConnectionMap.set(group.id, connection.id);

  console.log(`[CopyEngine] TopstepX streaming enabled for group "${group.name}" (${group.id}) - master ${masterExtId}`);
  return true;
}

async function handleWSPositionChange(group: CopyTradingGroup, event: TradovateWSEvent, masterAuth: ProviderAuth, masterExternalAccountId: string) {
  if (!lastKnownPositions.has(group.id)) {
    console.log(`[CopyEngine] WS: Ignoring position event for group ${group.id} - snapshot not initialized yet`);
    return;
  }

  const position = event.entity as TradovatePosition;

  if (event.accountId !== undefined && String(event.accountId) !== masterExternalAccountId) {
    return;
  }
  if (position.accountId !== undefined && String(position.accountId) !== masterExternalAccountId) {
    return;
  }
  const previousSnapshots = lastKnownPositions.get(group.id) || [];

  const contractId = String(position.contractId);
  const prev = previousSnapshots.find(p => p.contractId === contractId);
  const prevPos = prev?.netPos || 0;
  const delta = position.netPos - prevPos;

  if (delta === 0) return;

  const contract = await tradovateGetContract(masterAuth.token, position.contractId, masterAuth.isLive || false);
  const symbol = contract?.name || `Contract#${position.contractId}`;

  const updatedSnapshots = previousSnapshots.filter(p => p.contractId !== contractId);
  if (position.netPos !== 0) {
    updatedSnapshots.push({ contractId, symbol, netPos: position.netPos });
  }
  lastKnownPositions.set(group.id, updatedSnapshots);

  const change: PositionChange = {
    contractId,
    symbol,
    delta: Math.abs(delta),
    action: delta > 0 ? "Buy" : "Sell",
    masterPrice: position.netPrice || undefined,
  };

  const detectionTime = performance.now();
  console.log(`[CopyEngine] WS: Position change detected for group ${group.id}: ${change.action} ${change.delta}x ${change.symbol}`);

  const followers = await storage.getCopyFollowers(group.id);
  const enabledFollowers = followers.filter(f => f.enabled);

  const resolvedMaster = await resolveMasterConnection(group);
  const masterCreds = resolvedMaster?.creds || {};

  recordLatency("execution", "detection", performance.now() - detectionTime);

  const execStart = performance.now();
  const wsResults = await Promise.allSettled(enabledFollowers.map(follower =>
    executeFollowerOrder(group, follower, change, masterAuth, masterCreds)
  ));
  for (const r of wsResults) {
    if (r.status === "rejected") {
      console.warn(`[CopyEngine] WS fan-out error: ${r.reason?.message || r.reason}`);
    }
  }
  if (enabledFollowers.length > 0) {
    recordLatency("execution", "order_send", performance.now() - execStart);
    recordLatency("execution", "end_to_end", performance.now() - detectionTime);
  }

  if (resolvedMaster) {
    broadcastToUser(resolvedMaster.userId, "positionUpdate", {
      connectionId: resolvedMaster.connectionId,
      position: event.entity,
      change,
    });
  }
}

async function handleTopstepXPositionChange(
  group: CopyTradingGroup,
  event: TopstepXWSEvent,
  masterAuth: ProviderAuth,
  masterExternalAccountId: string,
  connection: any,
) {
  if (event.accountId !== undefined && String(event.accountId) !== masterExternalAccountId) {
    return;
  }

  const entity = event.entity;
  const contractId = String(entity.contractId);
  const currentNetPosition = entity.netPosition;

  const symbol = entity.symbol || `Contract#${contractId}`;
  const engineSnapshots = lastKnownPositions.get(group.id) || [];
  const engineEntry = engineSnapshots.find(p => p.contractId === contractId);
  const enginePrevNetPos = engineEntry?.netPos || 0;
  const delta = currentNetPosition - enginePrevNetPos;

  if (delta === 0) return;

  const updatedSnapshots = engineSnapshots.filter(p => p.contractId !== contractId);
  if (currentNetPosition !== 0) {
    updatedSnapshots.push({ contractId, symbol, netPos: currentNetPosition, price: entity.averagePrice || undefined });
  }
  lastKnownPositions.set(group.id, updatedSnapshots);

  let masterPrice: number | undefined = entity.averagePrice > 0 ? entity.averagePrice : undefined;

  if (!masterPrice) {
    try {
      const quoteResult = await getCurrentQuotePrice(masterAuth, contractId, { accountId: masterExternalAccountId });
      if (quoteResult.price && quoteResult.price > 0) {
        masterPrice = quoteResult.price;
      }
    } catch (quoteErr: any) {
      console.warn(`[CopyEngine] TopstepX quote fallback failed for ${contractId}: ${quoteErr?.message || "unknown"}`);
    }
  }

  if (!masterPrice) {
    console.warn(`[CopyEngine] TopstepX: No market quote available for ${symbol}, using fill/avg price for slippage (degraded mode)`);
  }

  const change: PositionChange = {
    contractId,
    symbol,
    delta: Math.abs(delta),
    action: delta > 0 ? "Buy" : "Sell",
    masterPrice,
  };

  const detectionTime = performance.now();
  console.log(`[CopyEngine] TopstepX: Position change for group ${group.id}: ${change.action} ${change.delta}x ${change.symbol} @ ${masterPrice ?? "N/A"}`);

  const followers = await storage.getCopyFollowers(group.id);
  const enabledFollowers = followers.filter(f => f.enabled);
  const resolvedMasterT = await resolveMasterConnection(group);
  const topstepCreds = resolvedMasterT?.creds || {};

  recordLatency("execution", "detection", performance.now() - detectionTime);

  const execStart = performance.now();
  const tsxResults = await Promise.allSettled(enabledFollowers.map(follower =>
    executeFollowerOrder(group, follower, change, masterAuth, { ...topstepCreds, accountId: masterExternalAccountId })
  ));
  for (const r of tsxResults) {
    if (r.status === "rejected") {
      console.warn(`[CopyEngine] TopstepX WS fan-out error: ${r.reason?.message || r.reason}`);
    }
  }
  if (enabledFollowers.length > 0) {
    recordLatency("execution", "order_send", performance.now() - execStart);
    recordLatency("execution", "end_to_end", performance.now() - detectionTime);
  }

  if (resolvedMasterT) {
    broadcastToUser(resolvedMasterT.userId, "positionUpdate", {
      connectionId: resolvedMasterT.connectionId,
      position: entity,
      change,
    });
  }
}

async function handleConsecutiveError(groupId: number, errorMessage: string) {
  const count = (consecutiveErrors.get(groupId) || 0) + 1;
  consecutiveErrors.set(groupId, count);

  if (count >= MAX_CONSECUTIVE_ERRORS) {
    console.error(`[CopyEngine] קבוצה ${groupId} חצתה סף של ${MAX_CONSECUTIVE_ERRORS} שגיאות רצופות — משהה אוטומטית`);
    try {
      stopGroupPolling(groupId);
      const group = await storage.getCopyGroup(groupId);
      if (group && group.status !== "error_paused") {
        await storage.updateCopyGroup(groupId, { status: "error_paused" });
        broadcastToUser(group.userId, "copyGroupErrorPaused", {
          groupId,
          groupName: group.name,
          errorCount: count,
          lastError: errorMessage,
        });
      }
    } catch (pauseErr: any) {
      console.error(`[CopyEngine] שגיאה בהשהיית קבוצה ${groupId}:`, pauseErr.message);
    }
    consecutiveErrors.delete(groupId);
  }
}

function resetConsecutiveErrors(groupId: number) {
  if (consecutiveErrors.has(groupId)) {
    consecutiveErrors.delete(groupId);
  }
}

function startFallbackPolling(group: CopyTradingGroup) {
  const existingTimer = activeTimers.get(group.id);
  if (existingTimer) {
    clearInterval(existingTimer);
    activeTimers.delete(group.id);
  }

  const interval = FALLBACK_POLL_INTERVAL_MS;
  console.log(`[CopyEngine] Starting fallback polling for group "${group.name}" (${group.id}) every ${interval}ms`);

  const timer = setInterval(async () => {
    if (groupLocks.get(group.id)) return;
    groupLocks.set(group.id, true);
    try {
      await pollGroup(group.id);
      resetConsecutiveErrors(group.id);
    } catch (err: any) {
      console.error(`[CopyEngine] Fallback poll error for group ${group.id}:`, err.message);
      await handleConsecutiveError(group.id, err.message);
    } finally {
      groupLocks.set(group.id, false);
    }
  }, interval);

  activeTimers.set(group.id, timer);
}

async function startGroupPolling(group: CopyTradingGroup) {
  await initializePositionSnapshot(group);

  const wsStarted = await tryStartWebSocket(group);

  const interval = wsStarted ? FALLBACK_POLL_INTERVAL_MS : (group.pollIntervalMs || 5000);
  const mode = wsStarted ? "WebSocket + fallback poll" : "polling";
  console.log(`[CopyEngine] מפעיל סריקה לקבוצה "${group.name}" (${group.id}) [${mode}] כל ${interval}ms`);

  const timer = setInterval(async () => {
    if (groupLocks.get(group.id)) return;
    groupLocks.set(group.id, true);
    try {
      await pollGroup(group.id);
      resetConsecutiveErrors(group.id);
    } catch (err: any) {
      console.error(`[CopyEngine] שגיאה בקבוצה ${group.id}:`, err.message);
      await handleConsecutiveError(group.id, err.message);
    } finally {
      groupLocks.set(group.id, false);
    }
  }, interval);

  activeTimers.set(group.id, timer);
}

function stopGroupPolling(groupId: number) {
  const timer = activeTimers.get(groupId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(groupId);
  }
  lastKnownPositions.delete(groupId);
  groupLocks.delete(groupId);
  consecutiveErrors.delete(groupId);

  if (wsEnabledGroups.has(groupId)) {
    wsEnabledGroups.delete(groupId);
    const wsClientId = wsGroupConnectionMap.get(groupId);
    const wsOwner = `copy-engine-group-${groupId}`;
    if (wsClientId !== undefined) {
      const groupListeners = wsGroupListeners.get(groupId);

      const tradovateClient = getExecWSClient(wsClientId);
      if (tradovateClient && groupListeners) {
        for (const { event, handler } of groupListeners) tradovateClient.removeListener(event, handler);
      }

      const topstepxClient = getExecTopstepXClient(wsClientId);
      if (topstepxClient && groupListeners) {
        for (const { event, handler } of groupListeners) topstepxClient.removeListener(event, handler);
      }

      wsGroupListeners.delete(groupId);
      releaseExecWSClient(wsClientId, wsOwner);
      releaseExecTopstepXClient(wsClientId, wsOwner);
      wsGroupConnectionMap.delete(groupId);
    }
  }

  console.log(`[CopyEngine] עוצר סריקה לקבוצה ${groupId}`);
}

export function stopAllCopyEngines() {
  for (const [groupId] of activeTimers) {
    stopGroupPolling(groupId);
  }
}

export async function restartGroupEngine(groupId: number) {
  stopGroupPolling(groupId);
  const group = await storage.getCopyGroup(groupId);
  if (group && group.status === "active") {
    await startGroupPolling(group);
  }
}

export function stopGroupEngine(groupId: number) {
  stopGroupPolling(groupId);
}

async function pollGroup(groupId: number) {
  const group = await storage.getCopyGroup(groupId);
  if (!group || group.status !== "active") {
    stopGroupPolling(groupId);
    return;
  }

  const heartbeatOk = await checkHeartbeat(group);
  if (!heartbeatOk) {
    console.warn(`[CopyEngine] Heartbeat timeout for group ${groupId}, auto-flattening`);
    await flattenAllPositions(groupId);
    await storage.updateCopyGroup(groupId, { status: "paused" });
    stopGroupPolling(groupId);
    return;
  }

  const resolved = await resolveMasterConnection(group);
  if (!resolved) return;

  const masterAuth = await authenticateProvider(resolved.providerKey, resolved.creds);
  if (!masterAuth) return;

  const masterAccountInfo = await resolveMasterAccountInfo(group);
  const currentSnapshots = await getProviderPositions(masterAuth, masterAccountInfo?.externalAccountId || "0");

  recordHeartbeat(groupId);

  const previousSnapshots = lastKnownPositions.get(groupId) || [];
  const changes = detectPositionChanges(previousSnapshots, currentSnapshots);

  lastKnownPositions.set(groupId, currentSnapshots);

  const followers = await storage.getCopyFollowers(groupId);
  const enabledFollowers = followers.filter(f => f.enabled);

  if (changes.length > 0) {
    for (const change of changes) {
      const results = await Promise.allSettled(
        enabledFollowers.map(follower =>
          executeFollowerOrder(group, follower, change, masterAuth, resolved.creds)
        )
      );
      for (const r of results) {
        if (r.status === "rejected") {
          console.warn(`[CopyEngine] Poll fan-out error: ${r.reason?.message || r.reason}`);
        }
      }
    }
  }

  await reconcilePendingOrders(groupId, enabledFollowers);

  const orphanCycleKey = `orphan_check_${groupId}`;
  const orphanCheckRegistry = globalThis as Record<string, number>;
  const lastOrphanCheck = orphanCheckRegistry[orphanCycleKey] || 0;
  const now = Date.now();
  if (now - lastOrphanCheck > 60000) {
    orphanCheckRegistry[orphanCycleKey] = now;
    try {
      const masterSymbols = new Set(currentSnapshots.filter(p => p.netPos !== 0).map(p => p.symbol.toLowerCase()));
      for (const follower of enabledFollowers) {
        try {
          const resolvedFollower = await resolveFollowerConnection(follower);
          if (!resolvedFollower) continue;
          const fAuth = await authenticateProvider(resolvedFollower.providerKey, resolvedFollower.creds);
          if (!fAuth) continue;
          const fAccountInfo = await resolveFollowerAccountInfo(follower);
          if (!fAccountInfo) continue;
          const fPositions = await getProviderPositions(fAuth, fAccountInfo.externalAccountId || "0");
          for (const pos of fPositions) {
            if (pos.netPos === 0) continue;
            if (!masterSymbols.has(pos.symbol.toLowerCase())) {
              const recentOrders = await storage.getCopyOrders(groupId, 100, 0);
              const matchingOrders = recentOrders.filter(
                o => o.symbol === pos.symbol && o.followerAccountId === follower.followerAccountId && !o.isOrphaned
              );
              for (const matchingOrder of matchingOrders) {
                await storage.updateCopyOrder(matchingOrder.id, { isOrphaned: true });
                console.log(`[CopyEngine] Marked order #${matchingOrder.id} as orphaned: ${pos.symbol} on follower ${follower.id}`);
              }
              if (matchingOrders.length === 0) {
                console.log(`[CopyEngine] Orphaned position detected: ${pos.symbol} (${pos.netPos} contracts) on follower ${follower.id} with no matching order records`);
              }
            }
          }
        } catch (followerOrphanErr: any) {
          console.warn(`[CopyEngine] Orphan check failed for follower ${follower.id}: ${followerOrphanErr?.message || "unknown"}`);
        }
      }
    } catch (orphanErr: any) {
      console.warn(`[CopyEngine] Orphan detection cycle failed for group ${groupId}: ${orphanErr?.message || "unknown"}`);
    }
  }
}

interface PositionChange {
  contractId: string;
  symbol: string;
  delta: number;
  action: "Buy" | "Sell";
  masterPrice?: number;
}

function detectPositionChanges(
  previous: PositionSnapshot[],
  current: PositionSnapshot[]
): PositionChange[] {
  const changes: PositionChange[] = [];
  const prevMap = new Map(previous.map(p => [p.contractId, p]));
  const currMap = new Map(current.map(c => [c.contractId, c]));

  for (const [contractId, curr] of currMap) {
    const prev = prevMap.get(contractId);
    const prevPos = prev?.netPos || 0;
    const delta = curr.netPos - prevPos;
    if (delta !== 0) {
      changes.push({
        contractId,
        symbol: curr.symbol,
        delta: Math.abs(delta),
        action: delta > 0 ? "Buy" : "Sell",
        masterPrice: curr.price,
      });
    }
  }

  for (const [contractId, prev] of prevMap) {
    if (!currMap.has(contractId) && prev.netPos !== 0) {
      changes.push({
        contractId,
        symbol: prev.symbol,
        delta: Math.abs(prev.netPos),
        action: prev.netPos > 0 ? "Sell" : "Buy",
        masterPrice: prev.price,
      });
    }
  }

  return changes;
}

async function executeFollowerOrder(
  group: CopyTradingGroup,
  follower: CopyTradingFollower,
  change: PositionChange,
  masterAuth: ProviderAuth,
  masterCreds: any
) {
  const followerAccountInfo = await resolveFollowerAccountInfo(follower);
  if (!followerAccountInfo) return;

  const masterAccountInfo = await resolveMasterAccountInfo(group);
  if (!masterAccountInfo) return;

  let currentPrice: number | null = null;
  let tickSize = 1;

  if (change.masterPrice) {
    try {
      const quoteResult = await getCurrentQuotePrice(masterAuth, change.contractId, masterCreds);
      tickSize = quoteResult.tickSize || 1;
      currentPrice = quoteResult.price;

      if (!currentPrice) {
        const freshPositions = await getProviderPositions(masterAuth, masterAccountInfo.externalAccountId || "0");
        const freshPos = freshPositions.find(p => p.contractId === change.contractId);
        if (freshPos?.price) {
          currentPrice = freshPos.price;
        }
      }
    } catch (quoteErr: any) {
      console.warn(`[CopyEngine] Quote lookup failed: ${quoteErr.message}`);
    }
  }

  const followerResolved = await resolveFollowerConnection(follower);
  const followerAuth = followerResolved
    ? await authenticateProvider(followerResolved.providerKey, followerResolved.creds)
    : null;

  const liveMargin = await fetchLiveAvailableMargin(follower, followerAccountInfo, followerAuth);
  const dynamicDrawdown = computeDynamicDrawdownLimit(followerAccountInfo, followerAuth);

  let liveRiskPercent: number | null = null;
  try {
    if (!follower.followerConnectionId) {
      const followerAccount = await storage.getAccount(follower.followerAccountId);
      if (followerAccount) {
        const drawdownType = followerAccount.drawdownType || "static";
        const maxDd = drawdownType === "trailing"
          ? (followerAccount.trailingDrawdown || followerAccount.maxDrawdown || 0)
          : (followerAccount.maxDrawdown || 0);
        if (maxDd > 0) {
          const peakBal = followerAccount.peakBalance || followerAccount.size;
          const equity = followerAccount.balance;
          const { computeTrailingDrawdownState } = await import("./trailing-drawdown");
          const ddState = drawdownType === "trailing"
            ? computeTrailingDrawdownState(followerAccount.size, maxDd, equity, peakBal, followerAccount.lowestEquity)
            : { trailingStop: followerAccount.size - maxDd, hwm: followerAccount.size };
          const eodLimit = ddState.trailingStop;
          const startOfDay = drawdownType === "trailing" ? ddState.hwm : followerAccount.size;
          const telemetry = calculateRiskTelemetry(equity, eodLimit, startOfDay);
          liveRiskPercent = telemetry.riskPercent;
        }
      }
    }
  } catch {}

  const quoteSource = (currentPrice && change.masterPrice)
    ? (Math.abs(currentPrice - change.masterPrice) / change.masterPrice > 0.01 ? "delayed" : "market")
    : undefined;

  const riskResult = await runRiskChecks({
    group,
    follower,
    symbol: change.symbol,
    action: change.action,
    qty: change.delta,
    masterPrice: change.masterPrice,
    followerBalance: followerAccountInfo.balance,
    followerSize: followerAccountInfo.size,
    followerMaxDrawdown: dynamicDrawdown,
    availableMargin: liveMargin,
    currentPrice,
    tickSize,
    quoteSource,
    liveRiskPercent,
  });

  if (!riskResult.passed) {
    const slippageBlocked = riskResult.checks.find(c => c.name === "slippage_check" && !c.passed);
    console.log(`[CopyEngine] Risk blocked: ${riskResult.blockReason} for ${followerAccountInfo.name}`);
    const blockedOrder = await storage.createCopyOrder({
      groupId: group.id,
      followerAccountId: follower.followerAccountId,
      masterOrderRef: `master-${change.contractId}-${Date.now()}`,
      symbol: change.symbol,
      side: change.action,
      quantity: change.delta,
      masterPrice: change.masterPrice,
      price: currentPrice ?? undefined,
      status: slippageBlocked ? "skipped_slippage" : "risk_blocked",
      errorMessage: riskResult.blockReason || "Blocked by risk engine",
      riskCheckResult: JSON.parse(JSON.stringify(riskResult)),
      slippageTicks: slippageBlocked ? slippageBlocked.value : undefined,
      masterDetectedAt: new Date(),
      latencyMs: 0,
    });

    if (riskResult.checks.find(c => c.name === "drawdown_check" && !c.passed)) {
      await storage.updateCopyFollower(follower.id, { status: "paused_risk", lastError: riskResult.blockReason || "Risk limit reached" });
    }

    const resolvedBroadcast = await resolveMasterConnection(group);
    if (resolvedBroadcast) {
      broadcastToUser(resolvedBroadcast.userId, "riskBlocked", {
        groupId: group.id,
        symbol: change.symbol,
        action: change.action,
        reason: riskResult.blockReason,
        followerName: followerAccountInfo.name,
        orderId: blockedOrder.id,
      });
    }
    return;
  }

  let rawQty: number;
  if (follower.sizingMode === "proportional" && masterAccountInfo.size > 0 && followerAccountInfo.size > 0) {
    const sizeRatio = followerAccountInfo.size / masterAccountInfo.size;
    rawQty = change.delta * sizeRatio * (follower.multiplier || 1);
  } else {
    rawQty = change.delta * (follower.multiplier || 1);
  }

  const qty = applyAdvancedSizing(rawQty, follower);
  if (qty <= 0) return;

  const dedupeWindowMs = (group.pollIntervalMs || 5000) * 3;
  const duplicate = await storage.findRecentDuplicateOrder(
    group.id, follower.followerAccountId, change.symbol, change.action, dedupeWindowMs
  );
  if (duplicate) {
    console.log(`[CopyEngine] דילוג על הזמנה כפולה: ${change.action} ${change.symbol} לחשבון ${followerAccountInfo.name} (order #${duplicate.id})`);
    return;
  }

  const configuredOrderType = follower.orderType || group.defaultOrderType || "Market";
  const timeInForce = follower.timeInForce || group.defaultTimeInForce || "Day";

  const detectedAt = new Date();
  const orderLog = await storage.createCopyOrder({
    groupId: group.id,
    followerAccountId: follower.followerAccountId,
    masterOrderRef: `master-${change.contractId}-${Date.now()}`,
    symbol: change.symbol,
    side: change.action,
    quantity: qty,
    masterPrice: change.masterPrice,
    status: "pending",
    masterDetectedAt: detectedAt,
    orderType: configuredOrderType,
    timeInForce,
    riskCheckResult: JSON.parse(JSON.stringify(riskResult)),
  });

  try {
    const resolvedFollower = await resolveFollowerConnection(follower);
    if (!resolvedFollower) {
      throw new Error("Follower connection not found or unsupported");
    }

    const followerAuth = await authenticateProvider(resolvedFollower.providerKey, resolvedFollower.creds);
    if (!followerAuth) throw new Error("Follower authentication failed");

    const followerExternalId = followerAccountInfo.externalAccountId || "0";
    if (followerExternalId === "0") throw new Error("Missing external account ID");

    const sentAt = new Date();
    await storage.updateCopyOrder(orderLog.id, { followerSentAt: sentAt, status: "sent" });

    incrementInFlightOrders();
    let result;
    try {
      result = await placeProviderOrder(
        followerAuth,
        followerAccountInfo.accountId,
        followerExternalId,
        change.contractId,
        change.action,
        qty,
        buildOrderParamsForCopy(configuredOrderType, change.masterPrice, timeInForce),
      );
    } finally {
      decrementInFlightOrders();
    }

    const filledAt = new Date();
    const latency = filledAt.getTime() - detectedAt.getTime();

    if (result.status === "filled") {
      recordLatency("execution", "order_fill", latency);
    }

    const tickSize = getTickSize(change.symbol) || 0.25;
    const slippageInfo = computeSlippage(change.masterPrice, result.avgPrice, tickSize);

    if (result.status === "filled" && result.avgPrice && change.masterPrice) {
      const pnl = (result.avgPrice - change.masterPrice) * qty * (change.action === "Buy" ? 1 : -1);
      if (pnl < 0) {
        recordDailyLoss(group.id, follower.id, Math.abs(pnl));
      }
    }

    await storage.updateCopyOrder(orderLog.id, {
      followerOrderRef: result.id,
      status: result.status,
      price: result.avgPrice,
      latencyMs: latency,
      followerFilledAt: result.status === "filled" ? filledAt : undefined,
      rawPayloadJson: result,
      slippageTicks: slippageInfo.slippageTicks,
      slippageDollars: slippageInfo.slippageDollars,
    });

    await storage.updateCopyFollower(follower.id, { status: "synced" });

    const sizingInfo = follower.sizingMode === "proportional" 
      ? `[prop ${followerAccountInfo.size}/${masterAccountInfo.size}]` 
      : `[fixed x${follower.multiplier}]`;
    console.log(`[CopyEngine] ✓ ${change.action} ${qty}x ${change.symbol} → ${followerAccountInfo.name} ${sizingInfo} (${latency}ms, slip: ${slippageInfo.slippageTicks?.toFixed(1) ?? '?'}t)`);
  } catch (err: any) {
    const resolvedFollowerConn = await resolveFollowerConnection(follower);
    const providerKey = resolvedFollowerConn?.providerKey || "unknown";
    const normalized = normalizeErrorCode(providerKey, err.message);
    console.error(`[CopyEngine] ✗ Copy error for ${followerAccountInfo?.name}:`, err.message);
    await storage.updateCopyOrder(orderLog.id, {
      status: "failed",
      errorMessage: err.message,
      normalizedError: normalized,
      latencyMs: Date.now() - detectedAt.getTime(),
    });
    await storage.updateCopyFollower(follower.id, { status: "error", lastError: err.message });
  }
}

async function reconcilePendingOrders(
  groupId: number,
  followers: CopyTradingFollower[],
) {
  const pendingOrders = await storage.getCopyOrders(groupId, 50, 0);
  const unresolvedOrders = pendingOrders.filter(o => o.status === "sent" || o.status === "pending");
  if (unresolvedOrders.length === 0) return;

  for (const follower of followers) {
    const followerOrders = unresolvedOrders.filter(o => o.followerAccountId === follower.followerAccountId);
    if (followerOrders.length === 0) continue;

    const resolvedFollowerConn = await resolveFollowerConnection(follower);
    if (!resolvedFollowerConn) continue;

    const followerAccountInfo = await resolveFollowerAccountInfo(follower);

    try {
      const followerAuth = await authenticateProvider(resolvedFollowerConn.providerKey, resolvedFollowerConn.creds);
      if (!followerAuth) continue;

      const followerExternalId = followerAccountInfo?.externalAccountId || "0";
      const liveOrders = await getProviderOrders(followerAuth, followerExternalId);

      for (const pendingOrder of followerOrders) {
        if (!pendingOrder.followerOrderRef) continue;

        const matchedOrder = liveOrders.find(o => o.id === pendingOrder.followerOrderRef);
        if (!matchedOrder) continue;

        let newStatus = pendingOrder.status;
        if (matchedOrder.status === "filled") {
          newStatus = "filled";
        } else if (matchedOrder.status === "rejected" || matchedOrder.status === "failed") {
          newStatus = matchedOrder.status;
        } else if (matchedOrder.filledQty > 0 && matchedOrder.filledQty < matchedOrder.totalQty) {
          newStatus = "partial";
        }

        if (newStatus !== pendingOrder.status) {
          const now = new Date();
          const latency = pendingOrder.masterDetectedAt
            ? now.getTime() - new Date(pendingOrder.masterDetectedAt).getTime()
            : pendingOrder.latencyMs;

          await storage.updateCopyOrder(pendingOrder.id, {
            status: newStatus,
            price: matchedOrder.avgPrice,
            latencyMs: latency,
            followerFilledAt: newStatus === "filled" ? now : undefined,
            rawPayloadJson: matchedOrder,
          });

          if (newStatus === "filled" && pendingOrder.followerOrderRef) {
            await handleCompositeOrderFill(pendingOrder.followerOrderRef, followerAuth.token);
          }

          console.log(`[CopyEngine] ↻ הזמנה #${pendingOrder.id} עודכנה: ${pendingOrder.status} → ${newStatus}`);
        }
      }
      for (const liveOrder of liveOrders) {
        if (liveOrder.status === "filled" && compositeOrderLinks.has(liveOrder.id)) {
          await handleCompositeOrderFill(liveOrder.id, followerAuth.token);
        }
      }
    } catch (err: any) {
      console.error(`[CopyEngine] שגיאה בהתאמת הזמנות עוקב #${follower.id}:`, err.message);
    }
  }
}

export function getEngineStatus(): { activeGroups: number; groupIds: number[] } {
  return {
    activeGroups: activeTimers.size,
    groupIds: Array.from(activeTimers.keys()),
  };
}

export function getEngineMapSizes(): Record<string, number> {
  return {
    lastKnownPositions: lastKnownPositions.size,
    activeTimers: activeTimers.size,
    groupLocks: groupLocks.size,
    consecutiveErrors: consecutiveErrors.size,
    wsGroupConnectionMap: wsGroupConnectionMap.size,
    wsGroupListeners: wsGroupListeners.size,
  };
}

export function isSupportedCopyProvider(key: string): boolean {
  return SUPPORTED_COPY_PROVIDERS.includes(key);
}

export async function enrichWebhookRiskContext(
  follower: CopyTradingFollower,
  symbol: string,
  masterPrice: number,
): Promise<{
  followerBalance: number;
  followerSize: number;
  followerMaxDrawdown: number | null;
  availableMargin: number | null;
  currentPrice: number | null;
  tickSize: number;
  quoteSource?: string;
}> {
  const followerAccountInfo = await resolveFollowerAccountInfo(follower);
  if (!followerAccountInfo) {
    return { followerBalance: 0, followerSize: 0, followerMaxDrawdown: null, availableMargin: null, currentPrice: null, tickSize: 1 };
  }

  const resolvedFollower = await resolveFollowerConnection(follower);
  const followerAuth = resolvedFollower
    ? await authenticateProvider(resolvedFollower.providerKey, resolvedFollower.creds)
    : null;

  const liveMargin = await fetchLiveAvailableMargin(follower, followerAccountInfo, followerAuth);
  const dynamicDrawdown = computeDynamicDrawdownLimit(followerAccountInfo, followerAuth);

  let currentPrice: number | null = null;
  let tickSize = 1;
  let quoteSource: string | undefined;

  if (followerAuth && masterPrice > 0) {
    try {
      let resolvedContractId = symbol;
      const followerExternalId = followerAccountInfo.externalAccountId || "0";
      const positions = await getProviderPositions(followerAuth, followerExternalId);
      const matchingPos = positions.find(p => p.symbol.toLowerCase().includes(symbol.toLowerCase()));
      if (matchingPos) {
        resolvedContractId = matchingPos.contractId;
      } else if (followerAuth.providerKey === "tradovate") {
        const numericId = await tradovateFindContractByName(followerAuth.token, symbol, followerAuth.isLive || false);
        if (numericId) resolvedContractId = String(numericId);
      } else if (followerAuth.providerKey === "topstepx") {
        const searchedId = await topstepxSearchContract(followerAuth.token, symbol);
        if (searchedId) resolvedContractId = searchedId;
      }

      const quoteResult = await getCurrentQuotePrice(followerAuth, resolvedContractId, {});
      currentPrice = quoteResult.price;
      tickSize = quoteResult.tickSize || 1;
      quoteSource = quoteResult.quoteSource;
    } catch (quoteErr: any) {
      console.warn(`[CopyEngine] Webhook quote lookup failed: ${quoteErr?.message || "unknown"}`);
    }
  }

  if (!quoteSource && currentPrice && masterPrice > 0) {
    quoteSource = Math.abs(currentPrice - masterPrice) / masterPrice > 0.01 ? "delayed" : "market";
  }

  return {
    followerBalance: followerAccountInfo.balance,
    followerSize: followerAccountInfo.size,
    followerMaxDrawdown: dynamicDrawdown,
    availableMargin: liveMargin,
    currentPrice,
    tickSize,
    quoteSource,
  };
}

export async function executeWebhookOrderForFollower(
  group: CopyTradingGroup,
  follower: CopyTradingFollower,
  symbol: string,
  action: "Buy" | "Sell",
  qty: number,
  orderParams?: OrderParams,
): Promise<{ success: boolean; orderId?: number; error?: string }> {
  try {
    const followerAccountInfo = await resolveFollowerAccountInfo(follower);
    if (!followerAccountInfo) return { success: false, error: "Follower account not found" };

    const resolvedFollower = await resolveFollowerConnection(follower);
    if (!resolvedFollower) return { success: false, error: "Follower connection not found" };

    const followerAuth = await authenticateProvider(resolvedFollower.providerKey, resolvedFollower.creds);
    if (!followerAuth) return { success: false, error: "Follower auth failed" };

    const followerExternalId = followerAccountInfo.externalAccountId || "0";
    if (followerExternalId === "0") return { success: false, error: "Missing external account ID" };

    let contractId = symbol;
    try {
      const positions = await getProviderPositions(followerAuth, followerExternalId);
      const matchingPos = positions.find(p => p.symbol.toLowerCase().includes(symbol.toLowerCase()));
      if (matchingPos) {
        contractId = matchingPos.contractId;
      } else if (followerAuth.providerKey === "tradovate") {
        const numericId = await tradovateFindContractByName(followerAuth.token, symbol, followerAuth.isLive || false);
        if (numericId) {
          contractId = String(numericId);
          console.log(`[CopyEngine] Resolved ${symbol} to Tradovate contractId ${numericId} via contract/find`);
        } else {
          return { success: false, error: `Cannot resolve symbol "${symbol}" to a Tradovate contract ID` };
        }
      } else if (followerAuth.providerKey === "topstepx") {
        const allPositions = await getProviderPositions(followerAuth, followerExternalId);
        const fuzzyMatch = allPositions.find(p =>
          p.symbol.toUpperCase().includes(symbol.toUpperCase()) ||
          p.contractId.toUpperCase().includes(symbol.toUpperCase())
        );
        if (fuzzyMatch) {
          contractId = fuzzyMatch.contractId;
          console.log(`[CopyEngine] Resolved ${symbol} to TopstepX contractId ${fuzzyMatch.contractId} via position match`);
        } else {
          const searchedId = await topstepxSearchContract(followerAuth.token, symbol);
          if (searchedId) {
            contractId = searchedId;
            console.log(`[CopyEngine] Resolved ${symbol} to TopstepX contractId ${searchedId} via contract search`);
          } else {
            return { success: false, error: `Cannot resolve symbol "${symbol}" to a TopstepX contract ID` };
          }
        }
      } else {
        return { success: false, error: `Cannot resolve symbol "${symbol}" for provider ${followerAuth.providerKey}` };
      }
    } catch (lookupErr: any) {
      console.warn(`[CopyEngine] Contract lookup failed for ${symbol}: ${lookupErr.message}`);
      return { success: false, error: `Contract resolution failed for ${symbol}: ${lookupErr.message}` };
    }

    const detectedAt = new Date();
    const orderLog = await storage.createCopyOrder({
      groupId: group.id,
      followerAccountId: follower.followerAccountId,
      masterOrderRef: `webhook-exec-${Date.now()}-${follower.id}`,
      symbol,
      side: action,
      quantity: qty,
      masterPrice: orderParams?.limitPrice || orderParams?.stopPrice || 0,
      status: "pending",
      masterDetectedAt: detectedAt,
      orderType: orderParams?.orderType || "Market",
      timeInForce: orderParams?.timeInForce || "Day",
      limitPrice: orderParams?.limitPrice,
      stopPrice: orderParams?.stopPrice,
    });

    incrementInFlightOrders();
    let result;
    try {
      result = await placeProviderOrder(
        followerAuth,
        followerAccountInfo.accountId,
        followerExternalId,
        contractId,
        action,
        qty,
        orderParams,
      );
    } finally {
      decrementInFlightOrders();
    }

    const filledAt = new Date();
    const latency = filledAt.getTime() - detectedAt.getTime();

    await storage.updateCopyOrder(orderLog.id, {
      followerOrderRef: result.id,
      status: result.status,
      price: result.avgPrice,
      latencyMs: latency,
      followerFilledAt: result.status === "filled" ? filledAt : undefined,
      followerSentAt: detectedAt,
    });

    return { success: true, orderId: orderLog.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

const heartbeatTimestamps = new Map<number, number>();
const heartbeatGraceExpiry = new Map<number, number>();

export function recordHeartbeat(groupId: number) {
  heartbeatTimestamps.set(groupId, Date.now());
}

export function getLastHeartbeat(groupId: number): number | undefined {
  return heartbeatTimestamps.get(groupId);
}

export async function checkHeartbeat(group: CopyTradingGroup): Promise<boolean> {
  const timeoutSec = group.heartbeatTimeoutSec;
  if (!timeoutSec || timeoutSec <= 0) return true;

  const last = heartbeatTimestamps.get(group.id);
  if (!last) {
    if (!heartbeatGraceExpiry.has(group.id)) {
      heartbeatGraceExpiry.set(group.id, Date.now() + (timeoutSec * 1000));
      console.log(`[CopyEngine] Heartbeat configured for group ${group.id} (${timeoutSec}s) — grace period active until first heartbeat or ${timeoutSec}s`);
    }
    const graceEnd = heartbeatGraceExpiry.get(group.id)!;
    if (Date.now() < graceEnd) {
      return true;
    }
    console.warn(`[CopyEngine] Heartbeat grace period expired for group ${group.id} — no heartbeat received within ${timeoutSec}s of startup`);
    return false;
  }

  heartbeatGraceExpiry.delete(group.id);

  const elapsed = (Date.now() - last) / 1000;
  if (elapsed > timeoutSec) {
    console.warn(`[CopyEngine] Heartbeat timeout for group ${group.id}: ${elapsed.toFixed(0)}s > ${timeoutSec}s`);
    return false;
  }
  return true;
}

export async function flattenAllPositions(groupId: number): Promise<{ closed: number; errors: string[] }> {
  const followers = await storage.getCopyFollowers(groupId);
  const errors: string[] = [];
  let closed = 0;

  for (const follower of followers) {
    try {
      const accountInfo = await resolveFollowerAccountInfo(follower);
      if (!accountInfo) continue;

      const resolved = await resolveFollowerConnection(follower);
      if (!resolved) continue;

      const auth = await authenticateProvider(resolved.providerKey, resolved.creds);
      if (!auth) continue;

      const externalId = accountInfo.externalAccountId || "0";
      const positions = await getProviderPositions(auth, externalId);

      for (const pos of positions) {
        if (pos.netPos === 0) continue;

        const action = pos.netPos > 0 ? "Sell" : "Buy";
        const qty = Math.abs(pos.netPos);

        try {
          await placeProviderOrder(auth, accountInfo.accountId, externalId, pos.contractId, action, qty);
          closed++;

          await storage.createCopyOrder({
            groupId,
            followerAccountId: follower.followerAccountId,
            masterOrderRef: `flatten-${Date.now()}`,
            symbol: pos.symbol,
            side: action,
            quantity: qty,
            status: "filled",
            masterDetectedAt: new Date(),
            latencyMs: 0,
            orderType: "Market",
            masterPrice: pos.price || 0,
          });
        } catch (err: any) {
          errors.push(`${accountInfo.name}/${pos.symbol}: ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Follower ${follower.id}: ${err.message}`);
    }
  }

  return { closed, errors };
}

export async function detectOrphanedTrades(groupId: number): Promise<{ orphaned: number; details: any[] }> {
  const group = await storage.getCopyGroup(groupId);
  if (!group) return { orphaned: 0, details: [] };

  const followers = await storage.getCopyFollowers(groupId);
  const masterAccountInfo = await resolveMasterAccountInfo(group);
  if (!masterAccountInfo) return { orphaned: 0, details: [] };

  const masterConnection = await resolveMasterConnection(group);
  if (!masterConnection) return { orphaned: 0, details: [] };

  const masterAuth = await authenticateProvider(masterConnection.providerKey, masterConnection.creds);
  if (!masterAuth) return { orphaned: 0, details: [] };

  const masterPositions = await getProviderPositions(masterAuth, masterAccountInfo.externalAccountId || "0");
  const masterSymbols = new Set(masterPositions.filter(p => p.netPos !== 0).map(p => p.symbol.toLowerCase()));

  const details: any[] = [];
  let orphaned = 0;

  for (const follower of followers) {
    try {
      const accountInfo = await resolveFollowerAccountInfo(follower);
      if (!accountInfo) continue;

      const resolved = await resolveFollowerConnection(follower);
      if (!resolved) continue;

      const auth = await authenticateProvider(resolved.providerKey, resolved.creds);
      if (!auth) continue;

      const externalId = accountInfo.externalAccountId || "0";
      const positions = await getProviderPositions(auth, externalId);

      for (const pos of positions) {
        if (pos.netPos === 0) continue;
        if (!masterSymbols.has(pos.symbol.toLowerCase())) {
          orphaned++;
          details.push({
            followerId: follower.id,
            followerName: accountInfo.name,
            symbol: pos.symbol,
            netPos: pos.netPos,
            price: pos.price,
          });
        }
      }
    } catch (err: any) {
      details.push({ followerId: follower.id, error: err.message });
    }
  }

  return { orphaned, details };
}
