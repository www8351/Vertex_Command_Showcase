import { validateTradovateAccount, type BrokerValidationResult } from "./broker-rules";
import { apiQueue } from "./api-queue";

const TRADOVATE_DEMO_URL = "https://demo.tradovateapi.com/v1";
const TRADOVATE_LIVE_URL = "https://live.tradovateapi.com/v1";
const TRADOVATE_DEMO_AUTH = "https://demo-d.tradovateapi.com";
const TRADOVATE_LIVE_AUTH = "https://live-d.tradovateapi.com";

interface TradovateAuthResponse {
  accessToken: string;
  userId: number;
  userStatus: string;
  name: string;
  expirationTime: string;
  errorText?: string;
  "p-ticket"?: string;
}

interface TradovateAccount {
  id: number;
  name: string;
  userId: number;
  accountType: string;
  active: boolean;
  clearingHouseId: number;
  riskCategoryId: number;
  autoLiqProfileId: number;
  marginAccountType: string;
  legalStatus: string;
  nickname?: string;
}

interface TradovateCashBalance {
  accountId: number;
  timestamp: string;
  tradeDate: { year: number; month: number; day: number };
  currencyId: number;
  amount: number;
  realizedPnL: number;
  weekRealizedPnL: number;
}

export interface DiscoveredAccount {
  accountId: string;
  name: string;
  externalId: string;
  balance: number;
  realizedPnL: number;
  size: number;
  active: boolean;
  brokerStatus?: string;
  brokerStatusRaw?: string;
  stage?: string;
  raw: any;
}

async function tryAuth(
  username: string,
  password: string,
  baseUrl: string,
  cid: number,
  sec: string,
): Promise<{ token: string; userId: number; name: string; errorText?: string } | null> {
  try {
    const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/auth/accesstokenrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: username,
        password: password,
        appId: "VertexCommand",
        appVersion: "1.0",
        deviceId: "vertex-server",
        cid,
        sec,
      }),
    });

    const rawText = await res.text();
    let data: TradovateAuthResponse;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error(`[Tradovate] Non-JSON response from ${baseUrl} (HTTP ${res.status}):`, rawText.substring(0, 500));
      return null;
    }

    if (data.errorText || !data.accessToken) {
      return { token: "", userId: 0, name: "", errorText: data.errorText };
    }

    return {
      token: data.accessToken,
      userId: data.userId,
      name: data.name,
    };
  } catch (err: any) {
    console.error(`[Tradovate] Auth exception from ${baseUrl}:`, err.message);
    return null;
  }
}

export async function tradovateAuth(
  username: string,
  password: string,
  cid?: number,
  sec?: string,
  environment?: "demo" | "live",
): Promise<{ token: string; userId: number; name: string; isLive: boolean }> {
  const clientId = cid || parseInt(process.env.TRADOVATE_CID || "0");
  const clientSec = sec || process.env.TRADOVATE_SEC || "";
  if (!clientId || !clientSec) {
    throw new Error("Tradovate CID and SEC are required (provide via credentials or TRADOVATE_CID/TRADOVATE_SEC env vars)");
  }

  let lastError = "";

  if (environment === "live") {
    const result = await tryAuth(username, password, TRADOVATE_LIVE_URL, clientId, clientSec);
    if (result && result.token) {
      console.log(`[Tradovate] Authenticated on LIVE as ${result.name}`);
      return { token: result.token, userId: result.userId, name: result.name, isLive: true };
    }
    if (result?.errorText) lastError = result.errorText;
  } else if (environment === "demo") {
    const result = await tryAuth(username, password, TRADOVATE_DEMO_URL, clientId, clientSec);
    if (result && result.token) {
      console.log(`[Tradovate] Authenticated on DEMO as ${result.name}`);
      return { token: result.token, userId: result.userId, name: result.name, isLive: false };
    }
    if (result?.errorText) lastError = result.errorText;
  } else {
    let result = await tryAuth(username, password, TRADOVATE_LIVE_URL, clientId, clientSec);
    if (result && result.token) {
      console.log(`[Tradovate] Authenticated on LIVE as ${result.name}`);
      return { token: result.token, userId: result.userId, name: result.name, isLive: true };
    }
    if (result?.errorText) lastError = result.errorText;

    result = await tryAuth(username, password, TRADOVATE_DEMO_URL, clientId, clientSec);
    if (result && result.token) {
      console.log(`[Tradovate] Authenticated on DEMO as ${result.name}`);
      return { token: result.token, userId: result.userId, name: result.name, isLive: false };
    }
    if (result?.errorText) lastError = result.errorText;
  }

  if (lastError) {
    throw new Error(`שגיאת Tradovate: ${lastError}`);
  }

  throw new Error(
    "לא הצלחנו להתחבר ל-Tradovate. בדוק שם משתמש וסיסמה."
  );
}

export async function tradovateGetAccounts(
  token: string,
  isLive: boolean
): Promise<TradovateAccount[]> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;

  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/account/list`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get accounts (${res.status}): ${text}`);
  }

  return res.json();
}

export async function tradovateGetCashBalance(
  token: string,
  accountId: number,
  isLive: boolean
): Promise<TradovateCashBalance | null> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;

  try {
    const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/cashBalance/getCashBalanceSnapshot?accountId=${accountId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface TradovatePosition {
  id: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  tradeDate: { year: number; month: number; day: number };
  netPos: number;
  netPrice: number;
  bought: number;
  boughtValue: number;
  sold: number;
  soldValue: number;
  prevPos: number;
  prevPrice: number;
}

export interface TradovateOrder {
  id: number;
  accountId: number;
  contractId: number;
  timestamp: string;
  action: string;
  ordStatus: string;
  ordType: string;
  price?: number;
  stopPrice?: number;
  qty: number;
  filledQty: number;
  avgPx?: number;
  text?: string;
}

export interface TradovateContract {
  id: number;
  name: string;
  contractMaturityId: number;
  status: string;
  providerTickSize: number;
}

export async function tradovateGetPositions(
  token: string,
  accountId: number,
  isLive: boolean
): Promise<TradovatePosition[]> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/position/list`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`שגיאת Tradovate: קבלת פוזיציות נכשלה (${res.status}): ${text}`);
  }
  const positions: TradovatePosition[] = await res.json();
  return positions.filter(p => p.accountId === accountId);
}

export async function tradovateGetContract(
  token: string,
  contractId: number,
  isLive: boolean
): Promise<TradovateContract | null> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  try {
    const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/contract/item?id=${contractId}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function tradovateFindContractByName(
  token: string,
  symbolName: string,
  isLive: boolean
): Promise<number | null> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  try {
    const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/contract/find?name=${encodeURIComponent(symbolName)}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const contract = await res.json();
    if (contract && contract.id) return contract.id;
    return null;
  } catch {
    return null;
  }
}

export async function tradovatePlaceOrder(
  token: string,
  accountSpec: string,
  accountId: number,
  contractId: number,
  action: "Buy" | "Sell",
  qty: number,
  isLive: boolean,
  orderType: "Market" | "Limit" | "Stop" | "StopLimit" | "TrailingStop" = "Market",
  price?: number,
  stopPrice?: number,
  timeInForce?: string,
  trailOffset?: number,
): Promise<TradovateOrder> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  const tifMap: Record<string, string> = { Day: "Day", GTC: "GTC", GTD: "GTD", IOC: "IOC", FOK: "FOK" };
  const body: Record<string, any> = {
    accountSpec,
    accountId,
    action,
    contractId,
    orderQty: qty,
    orderType,
    timeInForce: tifMap[timeInForce || "Day"] || "Day",
    isAutomated: true,
  };
  if ((orderType === "Limit" || orderType === "StopLimit") && price != null) {
    body.price = price;
  }
  if ((orderType === "Stop" || orderType === "StopLimit") && stopPrice != null) {
    body.stopPrice = stopPrice;
  }
  if (orderType === "TrailingStop" && trailOffset != null) {
    body.trailingStop = true;
    body.trail = trailOffset;
  }
  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/order/placeorder`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`שגיאת Tradovate: ביצוע פקודה נכשל (${res.status}): ${text}`);
  }
  return res.json();
}

export async function tradovateGetOrders(
  token: string,
  accountId: number,
  isLive: boolean
): Promise<TradovateOrder[]> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/order/list`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  const orders: TradovateOrder[] = await res.json();
  return orders.filter(o => o.accountId === accountId);
}

export interface DiscoveredAccountWithValidation extends DiscoveredAccount {
  validation: BrokerValidationResult;
}

export async function discoverTradovateAccounts(
  username: string,
  password: string,
  cid?: number,
  sec?: string,
  environment?: "demo" | "live",
): Promise<{ accounts: DiscoveredAccount[]; skipped: DiscoveredAccountWithValidation[]; userName: string; environment: string }> {
  const auth = await tradovateAuth(username, password, cid, sec, environment);

  const rawAccounts = await tradovateGetAccounts(auth.token, auth.isLive);

  console.log(`[Tradovate] נמצאו ${rawAccounts.length} חשבונות מה-API`);

  const eligible: DiscoveredAccount[] = [];
  const skipped: DiscoveredAccountWithValidation[] = [];

  for (const acc of rawAccounts) {
    let balance = 0;
    let realizedPnL = 0;

    const cashBalance = await tradovateGetCashBalance(auth.token, acc.id, auth.isLive);
    if (cashBalance) {
      balance = cashBalance.amount;
      realizedPnL = cashBalance.realizedPnL;
    }

    const validation = validateTradovateAccount({
      active: acc.active,
      legalStatus: acc.legalStatus,
      accountType: acc.accountType,
      marginAccountType: acc.marginAccountType,
      cashBalance: cashBalance ? { amount: cashBalance.amount } : undefined,
    });

    const brokerStatusParts = [];
    if (!acc.active) brokerStatusParts.push("inactive");
    if (acc.legalStatus && acc.legalStatus !== "Active") brokerStatusParts.push(`legal:${acc.legalStatus}`);
    const brokerStatus = brokerStatusParts.length > 0 ? brokerStatusParts.join(", ") : "active";

    const discovered: DiscoveredAccountWithValidation = {
      accountId: acc.name,
      name: acc.nickname || acc.name,
      externalId: String(acc.id),
      balance,
      realizedPnL,
      size: balance > 0 ? balance : 50000,
      active: acc.active,
      brokerStatus,
      brokerStatusRaw: JSON.stringify({ active: acc.active, legalStatus: acc.legalStatus, accountType: acc.accountType }),
      raw: { ...acc, cashBalance },
      validation,
    };

    if (validation.eligible) {
      eligible.push(discovered);
    } else {
      console.log(`[Tradovate] דילוג על חשבון ${discovered.name} (${discovered.externalId}): ${validation.skippedReason}`);
      skipped.push(discovered);
    }
  }

  console.log(`[Tradovate] תוצאה: ${eligible.length} תקינים, ${skipped.length} נדלגו`);

  return {
    accounts: eligible,
    skipped,
    userName: auth.name,
    environment: auth.isLive ? "live" : "demo",
  };
}

export function getTradovateOAuthUrl(
  environment: "demo" | "live",
  redirectUri: string,
  state: string,
): string {
  const cid = parseInt(process.env.TRADOVATE_CID || "0");
  if (!cid) throw new Error("TRADOVATE_CID is required for OAuth");
  const baseAuth = environment === "live" ? TRADOVATE_LIVE_AUTH : TRADOVATE_DEMO_AUTH;
  const params = new URLSearchParams({
    client_id: cid.toString(),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${baseAuth}/v1/auth/authorize?${params.toString()}`;
}

export async function tradovateOAuthExchange(
  code: string,
  redirectUri: string,
  environment: "demo" | "live",
): Promise<{ token: string; userId: number; name: string; isLive: boolean }> {
  const cid = parseInt(process.env.TRADOVATE_CID || "0");
  const sec = process.env.TRADOVATE_SEC || "";
  if (!cid || !sec) throw new Error("TRADOVATE_CID and TRADOVATE_SEC are required for OAuth");

  const baseUrl = environment === "live" ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;

  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/auth/oauthtoken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: cid,
      client_secret: sec,
    }),
  });

  const data: TradovateAuthResponse = await res.json();

  if (data.errorText || !data.accessToken) {
    throw new Error(data.errorText || "OAuth token exchange failed");
  }

  return {
    token: data.accessToken,
    userId: data.userId,
    name: data.name,
    isLive: environment === "live",
  };
}

export async function discoverTradovateAccountsWithToken(
  token: string,
  isLive: boolean,
): Promise<{ accounts: DiscoveredAccount[]; skipped: DiscoveredAccountWithValidation[]; userName: string; environment: string }> {
  const rawAccounts = await tradovateGetAccounts(token, isLive);

  console.log(`[Tradovate/OAuth] נמצאו ${rawAccounts.length} חשבונות מה-API`);

  const eligible: DiscoveredAccount[] = [];
  const skipped: DiscoveredAccountWithValidation[] = [];

  for (const acc of rawAccounts) {
    let balance = 0;
    let realizedPnL = 0;

    const cashBalance = await tradovateGetCashBalance(token, acc.id, isLive);
    if (cashBalance) {
      balance = cashBalance.amount;
      realizedPnL = cashBalance.realizedPnL;
    }

    const validation = validateTradovateAccount({
      active: acc.active,
      legalStatus: acc.legalStatus,
      accountType: acc.accountType,
      marginAccountType: acc.marginAccountType,
      cashBalance: cashBalance ? { amount: cashBalance.amount } : undefined,
    });

    const brokerStatusParts2 = [];
    if (!acc.active) brokerStatusParts2.push("inactive");
    if (acc.legalStatus && acc.legalStatus !== "Active") brokerStatusParts2.push(`legal:${acc.legalStatus}`);
    const brokerStatus2 = brokerStatusParts2.length > 0 ? brokerStatusParts2.join(", ") : "active";

    const discovered: DiscoveredAccountWithValidation = {
      accountId: acc.name,
      name: acc.nickname || acc.name,
      externalId: String(acc.id),
      balance,
      realizedPnL,
      size: balance > 0 ? balance : 50000,
      active: acc.active,
      brokerStatus: brokerStatus2,
      brokerStatusRaw: JSON.stringify({ active: acc.active, legalStatus: acc.legalStatus, accountType: acc.accountType }),
      raw: { ...acc, cashBalance },
      validation,
    };

    if (validation.eligible) {
      eligible.push(discovered);
    } else {
      console.log(`[Tradovate/OAuth] דילוג על חשבון ${discovered.name} (${discovered.externalId}): ${validation.skippedReason}`);
      skipped.push(discovered);
    }
  }

  console.log(`[Tradovate/OAuth] תוצאה: ${eligible.length} תקינים, ${skipped.length} נדלגו`);

  return {
    accounts: eligible,
    skipped,
    userName: rawAccounts[0]?.name || "OAuth User",
    environment: isLive ? "live" : "demo",
  };
}

export interface TradovateFill {
  id: number;
  orderId: number;
  contractId: number;
  timestamp: string;
  tradeDate: { year: number; month: number; day: number };
  action: string;
  qty: number;
  price: number;
  active: boolean;
}

export interface TradovateTradeResult {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  pnl: number;
  timestamp: string;
  exitTimestamp?: string;
}

interface TradovateFillResponse extends TradovateFill {
  accountId?: number;
}

async function tradovateGetFills(
  token: string,
  accountId: number,
  isLive: boolean
): Promise<TradovateFill[]> {
  const baseUrl = isLive ? TRADOVATE_LIVE_URL : TRADOVATE_DEMO_URL;
  const res = await apiQueue.enqueueFetch("tradovate", `${baseUrl}/fill/list`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  const fills: TradovateFillResponse[] = await res.json();
  return fills.filter(f => f.accountId === undefined || f.accountId === accountId);
}

export async function tradovateGetTrades(
  token: string,
  accountId: number,
  isLive: boolean
): Promise<TradovateTradeResult[]> {
  const fills = await tradovateGetFills(token, accountId, isLive);
  const orders = await tradovateGetOrders(token, accountId, isLive);

  const contractCache = new Map<number, string>();
  async function getSymbol(contractId: number): Promise<string> {
    if (contractCache.has(contractId)) return contractCache.get(contractId)!;
    const contract = await tradovateGetContract(token, contractId, isLive);
    const name = contract?.name || `Contract-${contractId}`;
    contractCache.set(contractId, name);
    return name;
  }

  if (fills.length > 0) {
    console.log(`[Tradovate] Processing ${fills.length} fills for account ${accountId}`);
    const trades: TradovateTradeResult[] = [];
    for (const fill of fills) {
      const symbol = await getSymbol(fill.contractId);
      trades.push({
        id: `fill-${fill.id}`,
        symbol,
        side: fill.action === "Buy" ? "Buy" : "Sell",
        quantity: fill.qty || 0,
        price: fill.price || 0,
        pnl: 0,
        timestamp: fill.timestamp || "",
      });
    }
    return trades;
  }

  if (orders.length > 0) {
    console.log(`[Tradovate] No fills found, using ${orders.length} filled orders for account ${accountId}`);
    const filledOrders = orders.filter(o => o.filledQty > 0);
    const trades: TradovateTradeResult[] = [];
    for (const order of filledOrders) {
      const symbol = await getSymbol(order.contractId);
      trades.push({
        id: `order-${order.id}`,
        symbol,
        side: order.action === "Buy" ? "Buy" : "Sell",
        quantity: order.filledQty || order.qty || 0,
        price: order.avgPx || order.price || 0,
        pnl: 0,
        timestamp: order.timestamp || "",
      });
    }
    return trades;
  }

  console.log(`[Tradovate] No trades found for account ${accountId}`);
  return [];
}
