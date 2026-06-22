import type { DiscoveredAccount } from "./tradovate-client";
import { validateTopstepXAccount, resolveTopstepXTier, type BrokerValidationResult } from "./broker-rules";
import { apiQueue } from "./api-queue";

const TOPSTEPX_API_URL = "https://api.topstepx.com";

const AUTH_CACHE_TTL_MS = 60_000;
const authCache = new Map<string, { token: string; expiresAt: number }>();

interface TopstepXAuthResponse {
  token: string | null;
  success?: boolean;
  errorCode?: number;
  errorMessage?: string | null;
}

interface TopstepXAccount {
  id: number;
  name: string;
  accountNumber: string;
  balance: number;
  trailingDrawdown: number;
  profitTarget: number;
  dailyLossLimit: number;
  maxContractsAllowed: number;
  status: string;
  accountType: string;
  isActive: boolean;
}

function invalidateAuthCache(userName: string, apiKey: string): void {
  authCache.delete(`${userName}:${apiKey}`);
}

async function topstepxAuth(
  userName: string,
  apiKey: string,
  forceRefresh = false,
): Promise<{ token: string }> {
  const cacheKey = `${userName}:${apiKey}`;
  if (!forceRefresh) {
    const cached = authCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { token: cached.token };
    }
  }

  try {
    const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Auth/loginKey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, apiKey }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[TopstepX] Auth HTTP ${res.status}: ${text}`);
      throw new Error(`שגיאת TopstepX: התחברות נכשלה (HTTP ${res.status})`);
    }

    const data: TopstepXAuthResponse = await res.json();
    console.log(`[TopstepX] Auth response:`, JSON.stringify({
      hasToken: !!data.token,
      errorMessage: data.errorMessage,
    }));

    if (data.success === false || data.errorMessage || !data.token) {
      const msg = data.errorMessage || (data.errorCode ? `Error code ${data.errorCode}` : "Authentication failed");
      throw new Error(`שגיאת TopstepX: ${msg}`);
    }

    authCache.set(cacheKey, { token: data.token, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

    return { token: data.token };
  } catch (err: any) {
    if (err.message?.includes("TopstepX") || err.message?.includes("topstepx")) throw err;
    console.error(`[TopstepX] Auth exception:`, err.message);
    throw new Error("לא הצלחנו להתחבר ל-TopstepX. בדוק שם משתמש ו-API Key.");
  }
}

async function topstepxGetAccounts(
  token: string,
): Promise<TopstepXAccount[]> {
  const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Account/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ onlyActive: false }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`שגיאה בקבלת חשבונות TopstepX (${res.status}): ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : (data.accounts || data.items || []);
}

export interface TopstepXPosition {
  accountId: number;
  contractId: string;
  symbol: string;
  netPosition: number;
  averagePrice: number;
}

export interface TopstepXOrder {
  id: number;
  accountId: number;
  contractId: string;
  symbol: string;
  side: string;
  quantity: number;
  filledQuantity: number;
  price: number;
  status: string;
  timestamp: string;
}

export async function topstepxAuthExport(
  userName: string,
  apiKey: string,
  forceRefresh = false,
): Promise<{ token: string }> {
  return topstepxAuth(userName, apiKey, forceRefresh);
}

export function invalidateTopstepxAuthCache(userName: string, apiKey: string): void {
  invalidateAuthCache(userName, apiKey);
}

export async function topstepxGetPositions(
  token: string,
  accountId: number,
): Promise<TopstepXPosition[]> {
  const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Position/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.positions || data.items || []);
}

export async function topstepxPlaceOrder(
  token: string,
  accountId: number,
  contractId: string,
  action: "Buy" | "Sell",
  qty: number,
  orderType: "market" | "limit" | "stop" | "stopLimit" | "trailingStop" = "market",
  price?: number,
  stopPrice?: number,
  timeInForce?: string,
  trailOffset?: number,
): Promise<TopstepXOrder> {
  const tifMap: Record<string, string> = { Day: "day", GTC: "gtc", GTD: "gtd", IOC: "ioc", FOK: "fok" };
  const body: Record<string, any> = {
    accountId,
    contractId,
    action: action === "Buy" ? "buy" : "sell",
    quantity: qty,
    orderType,
    timeInForce: tifMap[timeInForce || "Day"] || "day",
  };
  if ((orderType === "limit" || orderType === "stopLimit") && price != null) {
    body.price = price;
  }
  if ((orderType === "stop" || orderType === "stopLimit") && stopPrice != null) {
    body.stopPrice = stopPrice;
  }
  if (orderType === "trailingStop" && trailOffset != null) {
    body.trailOffset = trailOffset;
  }
  const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Order/place`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`שגיאת TopstepX: ביצוע פקודה נכשל (${res.status}): ${text}`);
  }
  return res.json();
}

export async function topstepxGetOrders(
  token: string,
  accountId: number,
): Promise<TopstepXOrder[]> {
  const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Order/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.orders || data.items || []);
}

export interface TopstepXTrade {
  id: number;
  accountId: number;
  contractId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  pnl: number;
  fees: number;
  timestamp: string;
  exitTimestamp?: string;
  status: string;
}

function parseContractSymbol(contractId: string): string {
  if (!contractId) return 'Unknown';
  const parts = contractId.split('.');
  if (parts.length >= 4) return parts[3];
  return contractId;
}

function parseSide(side: any): string {
  if (typeof side === 'number') return side === 0 ? 'Buy' : 'Sell';
  if (typeof side === 'string') {
    const s = side.toLowerCase();
    if (s === 'buy' || s === '0' || s === 'long') return 'Buy';
    if (s === 'sell' || s === '1' || s === 'short') return 'Sell';
    return side;
  }
  return 'Unknown';
}

function parseTrades(items: any[]): TopstepXTrade[] {
  return items.map((t: any) => ({
    id: t.id || t.tradeId || t.orderId || 0,
    accountId: t.accountId || t.account_id || 0,
    contractId: t.contractId || t.contract_id || '',
    symbol: parseContractSymbol(t.contractId || t.contract_id || t.symbol || ''),
    side: parseSide(t.side ?? t.action ?? t.buyOrSell),
    quantity: t.size || t.quantity || t.qty || t.filledQuantity || t.filledQty || 0,
    price: t.price || t.averagePrice || t.avgPrice || t.fillPrice || 0,
    pnl: (t.profitAndLoss ?? t.pnl ?? t.realizedPnl ?? t.profit ?? t.pl ?? 0) - (t.fees || 0),
    fees: t.fees || 0,
    timestamp: t.creationTimestamp || t.timestamp || t.entryTime || t.createdAt || t.time || t.fillTime || '',
    exitTimestamp: t.exitTimestamp || t.exitTime || t.completedAt || '',
    status: t.voided ? 'voided' : (t.status || 'closed'),
  }));
}

function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const key of ['trades', 'items', 'orders', 'fills', 'data', 'results', 'history']) {
    if (data[key] && Array.isArray(data[key])) return data[key];
  }
  return [];
}

export async function topstepxGetTrades(
  token: string,
  accountId: number,
): Promise<TopstepXTrade[]> {
  const now = new Date();
  const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const startTimestamp = startDate.toISOString();

  const endpoints = [
    {
      name: "Trade/search",
      url: `${TOPSTEPX_API_URL}/api/Trade/search`,
      bodies: [
        { accountId, startTimestamp },
        { accountId, startDate: startTimestamp },
        { accountId },
      ],
    },
    {
      name: "TradeHistory/search",
      url: `${TOPSTEPX_API_URL}/api/TradeHistory/search`,
      bodies: [
        { accountId, startTimestamp },
        { accountId },
      ],
    },
    {
      name: "Fill/search",
      url: `${TOPSTEPX_API_URL}/api/Fill/search`,
      bodies: [
        { accountId, startTimestamp },
        { accountId },
      ],
    },
    {
      name: "Order/search (filled)",
      url: `${TOPSTEPX_API_URL}/api/Order/search`,
      bodies: [
        { accountId, startTimestamp },
        { accountId },
      ],
      filterFilled: true,
    },
  ];

  for (const ep of endpoints) {
    for (const body of ep.bodies) {
      try {
        const res = await apiQueue.enqueueFetch("topstepx", ep.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          console.log(`[TopstepX] ${ep.name} returned ${res.status} with body ${JSON.stringify(body)}`);
          continue;
        }

        const data = await res.json();
        let items = extractArray(data);

        console.log(`[TopstepX] ${ep.name} returned ${items.length} items (body: ${JSON.stringify(body)})`);

        if (items.length > 0) {
          console.log(`[TopstepX] Sample item keys: ${Object.keys(items[0]).join(', ')}`);
          console.log(`[TopstepX] Sample item: ${JSON.stringify(items[0]).substring(0, 500)}`);
        }

        if (ep.filterFilled) {
          items = items.filter((o: any) => (o.filledQuantity || o.filledQty || 0) > 0 || o.status === 'filled' || o.status === 'Filled');
        }

        if (items.length > 0) {
          const trades = parseTrades(items);
          console.log(`[TopstepX] ✓ Got ${trades.length} trades from ${ep.name}`);
          return trades;
        }
      } catch (err: any) {
        console.log(`[TopstepX] ${ep.name} error: ${err.message}`);
      }
    }
  }

  console.log(`[TopstepX] No trades found for account ${accountId} across all endpoints`);
  return [];
}

export interface DiscoveredAccountWithValidation extends DiscoveredAccount {
  validation: BrokerValidationResult;
}

export async function discoverTopstepXAccounts(
  userName: string,
  apiKey: string,
): Promise<{ accounts: DiscoveredAccount[]; skipped: DiscoveredAccountWithValidation[]; userName: string; environment: string }> {
  const auth = await topstepxAuth(userName, apiKey);
  const rawAccounts = await topstepxGetAccounts(auth.token);

  console.log(`[TopstepX] נמצאו ${rawAccounts.length} חשבונות מה-API`);

  const eligible: DiscoveredAccount[] = [];
  const skipped: DiscoveredAccountWithValidation[] = [];

  for (const acc of rawAccounts) {
    const validation = validateTopstepXAccount(acc);
    const tier = resolveTopstepXTier(acc);
    const tsxBrokerParts = [];
    if (acc.isActive === false) tsxBrokerParts.push("inactive");
    if (acc.status && acc.status !== "Active" && acc.status !== "active") tsxBrokerParts.push(acc.status);
    const tsxBrokerStatus = tsxBrokerParts.length > 0 ? tsxBrokerParts.join(", ") : "active";

    const accTypeLower = (acc.accountType || "").toLowerCase();
    const accNameLower = (acc.name || "").toLowerCase();
    const detectedStage = accTypeLower.includes("live") || accTypeLower.includes("funded") || accTypeLower.includes("pa") || accNameLower.includes("pa-") || accNameLower.includes("live")
      ? "funded"
      : "evaluation_1";

    const discovered: DiscoveredAccountWithValidation = {
      accountId: acc.accountNumber || acc.name || String(acc.id),
      name: acc.name || acc.accountNumber || `חשבון TopstepX ${acc.id}`,
      externalId: String(acc.id),
      balance: acc.balance || 0,
      realizedPnL: 0,
      size: tier?.accountSize || (acc.balance > 0 ? acc.balance : 50000),
      active: acc.isActive !== false,
      brokerStatus: tsxBrokerStatus,
      brokerStatusRaw: JSON.stringify({ isActive: acc.isActive, status: acc.status, accountType: acc.accountType, trailingDrawdown: acc.trailingDrawdown, dailyLossLimit: acc.dailyLossLimit }),
      stage: detectedStage,
      raw: {
        ...acc,
        resolvedTier: tier,
        consistencyRule: tier?.consistencyRule || 40,
        target: tier?.profitTarget || acc.profitTarget || 0,
        maxDrawdown: tier?.maxLossLimit || acc.trailingDrawdown || 0,
        dailyLossLimit: tier?.dailyLossLimit || acc.dailyLossLimit || 0,
        maxContracts: tier?.maxContracts || acc.maxContractsAllowed || 0,
        minTradingDays: tier?.minTradingDays || 5,
      },
      validation,
    };

    if (validation.eligible) {
      eligible.push(discovered);
    } else {
      console.log(`[TopstepX] דילוג על חשבון ${discovered.name} (${discovered.externalId}): ${validation.skippedReason}`);
      skipped.push(discovered);
    }
  }

  console.log(`[TopstepX] תוצאה: ${eligible.length} תקינים, ${skipped.length} נדלגו`);

  return {
    accounts: eligible,
    skipped,
    userName,
    environment: "topstepx",
  };
}

export async function topstepxGetLastTradePrice(
  token: string,
  accountId: number,
  contractId: string,
): Promise<number | null> {
  try {
    const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Fill/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accountId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const fills = Array.isArray(data) ? data : (data?.fills || data?.data || []);
    const matching = fills
      .filter((f: any) => String(f.contractId) === contractId && f.price > 0)
      .sort((a: any, b: any) => {
        const ta = new Date(a.timestamp || a.fillTime || 0).getTime();
        const tb = new Date(b.timestamp || b.fillTime || 0).getTime();
        return tb - ta;
      });
    if (matching.length > 0) {
      return matching[0].price;
    }
    return null;
  } catch {
    return null;
  }
}

export async function topstepxSearchContract(
  token: string,
  symbolQuery: string,
): Promise<string | null> {
  try {
    const res = await apiQueue.enqueueFetch("topstepx", `${TOPSTEPX_API_URL}/api/Contract/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: symbolQuery }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const contracts = Array.isArray(data) ? data : (data?.contracts || data?.items || data?.data || []);
    if (contracts.length === 0) return null;
    const exact = contracts.find((c: any) =>
      (c.name || c.symbol || "").toUpperCase() === symbolQuery.toUpperCase()
    );
    const match = exact || contracts[0];
    return String(match.id || match.contractId || "");
  } catch (err: any) {
    console.warn(`[TopstepX] Contract search failed for "${symbolQuery}": ${err?.message || "unknown"}`);
    return null;
  }
}
