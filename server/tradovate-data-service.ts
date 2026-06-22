/**
 * Tradovate / TopstepX raw-data extraction layer.
 *
 * Goal: pull broker state into clean TypeScript shapes the monitor UI and copy
 * engine can consume. No risk checks, no validation, no status derivation —
 * just typed in-memory snapshots updated from REST polls and WS pushes.
 *
 * Wire the real API calls into the marked TODOs. Everything below is structure
 * + stub bodies returning empty/dummy values so the rest of the app can compile
 * and iterate against the contracts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Account & Balances (real-time state)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountSnapshot {
  /** Internal Tradovate account id (numeric). */
  accountId: number;
  /** Display name / account number string. e.g. "TS-50K-11590906". */
  accountName: string;

  /** Previous day end-of-day cash balance, before any floating P&L. */
  cashBalance: number;
  /** Real-time equity = cashBalance + unrealizedPnl. Net Liquidating Value. */
  netLiquidatingValue: number;
  /** Hard drawdown floor reported by broker (auto-liquidate threshold). */
  autoLiquidateThreshold: number;

  /** Initial margin requirement for currently held positions. */
  initialMargin: number;
  /** Maintenance margin requirement for currently held positions. */
  maintenanceMargin: number;

  /** Realized P&L for the current trading day (closed trades only). */
  realizedPnlToday: number;
  /** Floating P&L from currently open positions, mark-to-market. */
  unrealizedPnl: number;

  /** Server timestamp (ms epoch) when this snapshot was last refreshed. */
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Open positions (current market exposure)
// ─────────────────────────────────────────────────────────────────────────────

export type PositionSide = 'long' | 'short' | 'flat';

export interface PositionSnapshot {
  accountId: number;

  /** Tradable contract symbol, e.g. "NQZ4", "ESM4", "MNQH5". */
  symbol: string;
  /** Underlying root, e.g. "NQ", "ES". Useful for cross-month aggregation. */
  productCode: string;

  /** Signed quantity. Positive=long, negative=short, 0=flat. */
  netPosition: number;
  side: PositionSide;

  /** Volume-weighted average entry price across the open lots. */
  averageEntryPrice: number;

  /** Latest market price from feed (last trade or mid). */
  currentMarketPrice: number;

  /** netPosition * (currentMarketPrice − averageEntryPrice) * pointValue. */
  unrealizedPnl: number;
  /** Tick size and dollar-per-point (cached for downstream PnL math). */
  tickSize: number;
  pointValue: number;

  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Executions / fills (copy trading source-of-truth)
// ─────────────────────────────────────────────────────────────────────────────

export type FillAction = 'buy' | 'sell';

export interface FillEvent {
  accountId: number;

  /** Tradovate executionId — unique per fill. Use as dedupe key on follower side. */
  fillId: string;
  /** Tradovate orderId that produced the fill. May span multiple fills. */
  orderId: string;

  symbol: string;
  productCode: string;

  action: FillAction;
  fillPrice: number;
  /** Always positive. Direction lives in `action`. */
  quantity: number;

  /** Millisecond epoch — used for end-to-end latency measurement. */
  timestamp: number;

  commission: number;
  fees: number;

  /** Raw broker payload kept for audit/debug. Never relied on by callers. */
  raw?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Orders (order book status)
// ─────────────────────────────────────────────────────────────────────────────

export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected' | 'pending';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export interface OrderSnapshot {
  accountId: number;

  orderId: string;
  symbol: string;
  productCode: string;

  status: OrderStatus;
  type: OrderType;
  action: FillAction;

  /** Original requested quantity. */
  quantity: number;
  /** Cumulative filled qty. quantity − filledQuantity = remaining working size. */
  filledQuantity: number;

  /** Defined when type ∈ {limit, stop_limit}. */
  limitPrice?: number;
  /** Defined when type ∈ {stop, stop_limit}. */
  stopPrice?: number;

  timeInForce: TimeInForce;

  /** Avg fill price across child fills, or undefined if not yet filled. */
  averageFillPrice?: number;

  placedAt: number;
  /** Last status-change timestamp from broker. */
  updatedAt: number;

  rejectReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store the monitor UI / copy engine reads from
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountState {
  account: AccountSnapshot;
  positions: Map<string, PositionSnapshot>;       // key = symbol
  orders: Map<string, OrderSnapshot>;             // key = orderId
  recentFills: FillEvent[];                       // newest-first, capped
}

type FillListener = (fill: FillEvent) => void;
type AccountListener = (snap: AccountSnapshot) => void;
type PositionListener = (pos: PositionSnapshot) => void;
type OrderListener = (order: OrderSnapshot) => void;

export interface TradovateAuth {
  accessToken: string;
  /** ms epoch when accessToken expires; refresh before this. */
  expiresAt: number;
  /** "live" or "demo". */
  environment: 'live' | 'demo';
  /** Tradovate user id this token belongs to. */
  userId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TradovateDataService — stubbed extraction layer
// ─────────────────────────────────────────────────────────────────────────────

const FILL_BUFFER_SIZE = 200;

interface ContractMeta {
  symbol: string;
  productCode: string;
  tickSize: number;
  pointValue: number;
}

export class TradovateDataService {
  private auth: TradovateAuth | null = null;
  private state = new Map<number, AccountState>();   // key = accountId
  private contracts = new Map<number, ContractMeta>(); // key = contractId
  private orderFillProgress = new Map<string, number>(); // orderId → last filledQty seen

  private fillListeners = new Set<FillListener>();
  private accountListeners = new Set<AccountListener>();
  private positionListeners = new Set<PositionListener>();
  private orderListeners = new Set<OrderListener>();

  // ── Auth / lifecycle ───────────────────────────────────────────────────────

  setAuth(auth: TradovateAuth): void {
    this.auth = auth;
  }

  getAuth(): TradovateAuth | null {
    return this.auth;
  }

  /** Initialise state for an account we are tracking. Idempotent. */
  registerAccount(accountId: number, accountName: string): AccountState {
    let s = this.state.get(accountId);
    if (s) return s;
    s = {
      account: this.emptyAccountSnapshot(accountId, accountName),
      positions: new Map(),
      orders: new Map(),
      recentFills: [],
    };
    this.state.set(accountId, s);
    return s;
  }

  unregisterAccount(accountId: number): void {
    this.state.delete(accountId);
  }

  // ── Read API for monitor UI / copy engine ──────────────────────────────────

  getAccountState(accountId: number): AccountState | undefined {
    return this.state.get(accountId);
  }

  getAllAccounts(): AccountSnapshot[] {
    return Array.from(this.state.values()).map(s => s.account);
  }

  getPositions(accountId: number): PositionSnapshot[] {
    const s = this.state.get(accountId);
    return s ? Array.from(s.positions.values()) : [];
  }

  getOrders(accountId: number, status?: OrderStatus): OrderSnapshot[] {
    const s = this.state.get(accountId);
    if (!s) return [];
    const all = Array.from(s.orders.values());
    return status ? all.filter(o => o.status === status) : all;
  }

  getRecentFills(accountId: number, limit = 50): FillEvent[] {
    const s = this.state.get(accountId);
    return s ? s.recentFills.slice(0, limit) : [];
  }

  // ── Subscriptions (used by copy engine + UI websocket bridge) ──────────────

  onFill(fn: FillListener): () => void { this.fillListeners.add(fn); return () => this.fillListeners.delete(fn); }
  onAccount(fn: AccountListener): () => void { this.accountListeners.add(fn); return () => this.accountListeners.delete(fn); }
  onPosition(fn: PositionListener): () => void { this.positionListeners.add(fn); return () => this.positionListeners.delete(fn); }
  onOrder(fn: OrderListener): () => void { this.orderListeners.add(fn); return () => this.orderListeners.delete(fn); }

  // ── Fetch entry points (REST polls). Wire to real endpoints. ───────────────

  async refreshAccount(accountId: number): Promise<AccountSnapshot> {
    // TODO: Tradovate `/account/list` + `/cashBalance/getCashBalanceSnapshot`
    //       TopstepX equivalent: `/Account/{id}` + `/Account/getMetrics`
    const stub = this.emptyAccountSnapshot(accountId, this.state.get(accountId)?.account.accountName ?? `Account ${accountId}`);
    this.applyAccount(stub);
    return stub;
  }

  async refreshPositions(accountId: number): Promise<PositionSnapshot[]> {
    // TODO: Tradovate `/position/list?accountId=...`
    return [];
  }

  async refreshOrders(accountId: number): Promise<OrderSnapshot[]> {
    // TODO: Tradovate `/order/list?accountId=...` (today's working+filled)
    return [];
  }

  async refreshFills(accountId: number, sinceTs?: number): Promise<FillEvent[]> {
    // TODO: Tradovate `/executionReport/list?accountId=...&from=sinceTs`
    void sinceTs;
    return [];
  }

  // ── Contract cache (contractId → symbol metadata) ──────────────────────────

  /** Register/update a contract so position+order events can resolve symbols. */
  setContract(contractId: number, meta: ContractMeta): void {
    this.contracts.set(contractId, meta);
  }

  getContract(contractId: number): ContractMeta | undefined {
    return this.contracts.get(contractId);
  }

  // ── Push entry points (WS handlers). Map raw events → typed snapshots. ─────

  /**
   * Account-meta event from `users.accounts` sync. Carries id + name; balances
   * arrive via cashBalance events. Merge into existing snapshot if present.
   */
  ingestAccountEvent(raw: any): void {
    if (!raw) return;
    const accountId = raw.id ?? raw.accountId;
    if (typeof accountId !== 'number') return;
    const accountName = raw.name ?? raw.nickname ?? `Account ${accountId}`;
    const existing = this.state.get(accountId)?.account;
    const next: AccountSnapshot = {
      ...(existing ?? this.emptyAccountSnapshot(accountId, accountName)),
      accountId,
      accountName,
      autoLiquidateThreshold: typeof raw.autoLiqProfileId === 'number' ? existing?.autoLiquidateThreshold ?? 0 : existing?.autoLiquidateThreshold ?? 0,
      updatedAt: Date.now(),
    };
    this.applyAccount(next);
  }

  /**
   * Cash-balance event from `users.cashBalances`. Tradovate fields:
   *   { accountId, cashBalance, openPnL, totalPnL, dayPnL, weekPnL,
   *     initialMargin, maintenanceMargin, autoLiquidationThreshold }
   * Note: `cashBalance` here is real-time cash; openPnL is floating P&L on open
   * positions. NLV = cashBalance + openPnL.
   */
  ingestCashBalanceEvent(raw: any): void {
    if (!raw || typeof raw.accountId !== 'number') return;
    const existing = this.state.get(raw.accountId)?.account ?? this.emptyAccountSnapshot(raw.accountId, `Account ${raw.accountId}`);
    const cash = numOr(raw.cashBalance, existing.cashBalance);
    const open = numOr(raw.openPnL, existing.unrealizedPnl);
    const next: AccountSnapshot = {
      ...existing,
      cashBalance: cash,
      unrealizedPnl: open,
      netLiquidatingValue: cash + open,
      realizedPnlToday: numOr(raw.dayPnL, existing.realizedPnlToday),
      initialMargin: numOr(raw.initialMargin, existing.initialMargin),
      maintenanceMargin: numOr(raw.maintenanceMargin, existing.maintenanceMargin),
      autoLiquidateThreshold: numOr(raw.autoLiquidationThreshold, existing.autoLiquidateThreshold),
      updatedAt: Date.now(),
    };
    this.applyAccount(next);
  }

  /**
   * Position event from `users.positions`. Tradovate shape:
   *   { id, accountId, contractId, netPos, netPrice, ... }
   * Symbol resolution requires the contracts cache; falls back to
   * "contract:<id>" until populated by a separate REST lookup.
   */
  ingestPositionEvent(raw: any): void {
    if (!raw || typeof raw.accountId !== 'number') return;
    const meta = typeof raw.contractId === 'number' ? this.contracts.get(raw.contractId) : undefined;
    const symbol = meta?.symbol ?? (raw.contractId != null ? `contract:${raw.contractId}` : 'unknown');
    const productCode = meta?.productCode ?? symbol;
    const netPos = numOr(raw.netPos, 0);
    const side: PositionSide = netPos > 0 ? 'long' : netPos < 0 ? 'short' : 'flat';

    const pos: PositionSnapshot = {
      accountId: raw.accountId,
      symbol,
      productCode,
      netPosition: netPos,
      side,
      averageEntryPrice: numOr(raw.netPrice, 0),
      currentMarketPrice: 0,            // populated by market-data feed, not WS pos event
      unrealizedPnl: 0,                 // computed downstream when price arrives
      tickSize: meta?.tickSize ?? 0,
      pointValue: meta?.pointValue ?? 0,
      updatedAt: Date.now(),
    };
    this.applyPosition(pos);
  }

  /**
   * Order event from `users.orders` (also covers executionReport entityType).
   * Tradovate shape:
   *   { id, accountId, contractId, action, ordStatus, ordType,
   *     price, stopPrice, qty, filledQty, avgPx, timestamp, text }
   *
   * Side-effect: when filledQty increases, emits a synthetic FillEvent so the
   * copy engine has a single subscription point regardless of broker.
   */
  ingestOrderEvent(raw: any): void {
    if (!raw || typeof raw.id === 'undefined' || typeof raw.accountId !== 'number') return;
    const orderId = String(raw.id);
    const meta = typeof raw.contractId === 'number' ? this.contracts.get(raw.contractId) : undefined;
    const symbol = meta?.symbol ?? (raw.contractId != null ? `contract:${raw.contractId}` : 'unknown');
    const productCode = meta?.productCode ?? symbol;

    const order: OrderSnapshot = {
      accountId: raw.accountId,
      orderId,
      symbol,
      productCode,
      status: mapOrderStatus(raw.ordStatus),
      type: mapOrderType(raw.ordType),
      action: mapOrderAction(raw.action),
      quantity: numOr(raw.qty, 0),
      filledQuantity: numOr(raw.filledQty, 0),
      limitPrice: typeof raw.price === 'number' ? raw.price : undefined,
      stopPrice: typeof raw.stopPrice === 'number' ? raw.stopPrice : undefined,
      timeInForce: mapTimeInForce(raw.timeInForce),
      averageFillPrice: typeof raw.avgPx === 'number' ? raw.avgPx : undefined,
      placedAt: parseTs(raw.timestamp),
      updatedAt: Date.now(),
      rejectReason: raw.text && order_isRejected(raw.ordStatus) ? String(raw.text) : undefined,
    };
    this.applyOrder(order);

    // Synthesize fill events on filledQty increase.
    const prevFilled = this.orderFillProgress.get(orderId) ?? 0;
    if (order.filledQuantity > prevFilled) {
      const deltaQty = order.filledQuantity - prevFilled;
      this.orderFillProgress.set(orderId, order.filledQuantity);
      const fill: FillEvent = {
        accountId: order.accountId,
        fillId: `${orderId}:${order.filledQuantity}`,   // dedupe key
        orderId,
        symbol,
        productCode,
        action: order.action,
        fillPrice: order.averageFillPrice ?? 0,
        quantity: deltaQty,
        timestamp: parseTs(raw.timestamp),
        commission: 0,
        fees: 0,
        raw,
      };
      this.applyFill(fill);
    }
  }

  // ── TopstepX bridge (different streaming module, similar shapes) ────────────

  /**
   * TopstepX position change event:
   *   { contractId: string, symbol: string, netPosition: number,
   *     previousNetPosition: number, averagePrice: number }
   * TopstepX provides `symbol` directly so contract cache isn't required.
   */
  ingestTopstepXPosition(accountId: number, raw: any): void {
    if (!raw || !Number.isFinite(accountId)) return;
    const symbol: string = raw.symbol ?? `contract:${raw.contractId ?? 'unknown'}`;
    const netPos = numOr(raw.netPosition, 0);
    const side: PositionSide = netPos > 0 ? 'long' : netPos < 0 ? 'short' : 'flat';
    this.applyPosition({
      accountId,
      symbol,
      productCode: symbol.replace(/[A-Z][0-9]+$/, ''),
      netPosition: netPos,
      side,
      averageEntryPrice: numOr(raw.averagePrice, 0),
      currentMarketPrice: 0,
      unrealizedPnl: 0,
      tickSize: 0,
      pointValue: 0,
      updatedAt: Date.now(),
    });
  }

  /**
   * TopstepX equity event:
   *   { balance, trailingDrawdown, isActive, status, name? }
   * Maps balance → cashBalance and netLiquidatingValue (TopstepX poll doesn't
   * split open vs closed P&L). Auto-liquidate threshold derived as
   * balance − trailingDrawdown when both present.
   */
  ingestTopstepXEquity(accountId: number, raw: any): void {
    if (!raw || !Number.isFinite(accountId)) return;
    const existing = this.state.get(accountId)?.account ?? this.emptyAccountSnapshot(accountId, raw.name ?? `Account ${accountId}`);
    const balance = numOr(raw.balance, existing.cashBalance);
    const trailingDd = numOr(raw.trailingDrawdown, 0);
    this.applyAccount({
      ...existing,
      accountName: raw.name ?? existing.accountName,
      cashBalance: balance,
      netLiquidatingValue: balance,
      autoLiquidateThreshold: trailingDd > 0 ? balance - trailingDd : existing.autoLiquidateThreshold,
      updatedAt: Date.now(),
    });
  }

  /**
   * Direct executionReport event when broker emits one (some Tradovate streams
   * separate fills from order-state). Caller should pass the raw report.
   */
  ingestFillEvent(raw: any): void {
    if (!raw || typeof raw.accountId !== 'number') return;
    const orderId = String(raw.orderId ?? raw.commandId ?? '');
    const fillId = String(raw.id ?? `${orderId}:${raw.timestamp ?? Date.now()}`);
    const meta = typeof raw.contractId === 'number' ? this.contracts.get(raw.contractId) : undefined;
    const symbol = meta?.symbol ?? (raw.contractId != null ? `contract:${raw.contractId}` : 'unknown');

    const fill: FillEvent = {
      accountId: raw.accountId,
      fillId,
      orderId,
      symbol,
      productCode: meta?.productCode ?? symbol,
      action: mapOrderAction(raw.action),
      fillPrice: numOr(raw.price ?? raw.fillPrice, 0),
      quantity: numOr(raw.qty ?? raw.quantity, 0),
      timestamp: parseTs(raw.timestamp),
      commission: numOr(raw.commission, 0),
      fees: numOr(raw.fees, 0),
      raw,
    };
    this.applyFill(fill);
  }

  // ── Internal upserts ───────────────────────────────────────────────────────

  applyAccount(snap: AccountSnapshot): void {
    const s = this.registerAccount(snap.accountId, snap.accountName);
    s.account = snap;
    this.accountListeners.forEach(fn => fn(snap));
  }

  applyPosition(pos: PositionSnapshot): void {
    const s = this.registerAccount(pos.accountId, this.state.get(pos.accountId)?.account.accountName ?? `Account ${pos.accountId}`);
    if (pos.netPosition === 0) {
      s.positions.delete(pos.symbol);
    } else {
      s.positions.set(pos.symbol, pos);
    }
    this.positionListeners.forEach(fn => fn(pos));
  }

  applyOrder(order: OrderSnapshot): void {
    const s = this.registerAccount(order.accountId, this.state.get(order.accountId)?.account.accountName ?? `Account ${order.accountId}`);
    s.orders.set(order.orderId, order);
    this.orderListeners.forEach(fn => fn(order));
  }

  applyFill(fill: FillEvent): void {
    const s = this.registerAccount(fill.accountId, this.state.get(fill.accountId)?.account.accountName ?? `Account ${fill.accountId}`);
    if (s.recentFills.some(f => f.fillId === fill.fillId)) return;   // dedupe
    s.recentFills.unshift(fill);
    if (s.recentFills.length > FILL_BUFFER_SIZE) s.recentFills.length = FILL_BUFFER_SIZE;
    this.fillListeners.forEach(fn => fn(fill));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private emptyAccountSnapshot(accountId: number, accountName: string): AccountSnapshot {
    return {
      accountId,
      accountName,
      cashBalance: 0,
      netLiquidatingValue: 0,
      autoLiquidateThreshold: 0,
      initialMargin: 0,
      maintenanceMargin: 0,
      realizedPnlToday: 0,
      unrealizedPnl: 0,
      updatedAt: Date.now(),
    };
  }
}

// Single shared instance for convenience. Routes/engines can also new their own.
export const tradovateData = new TradovateDataService();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (Tradovate field → our enum mappings)
// ─────────────────────────────────────────────────────────────────────────────

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseTs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

function mapOrderStatus(s: unknown): OrderStatus {
  const k = String(s ?? '').toLowerCase();
  if (k.includes('fill')) return 'filled';
  if (k.includes('cancel')) return 'cancelled';
  if (k.includes('reject')) return 'rejected';
  if (k.includes('pending') || k.includes('new') || k.includes('suspend')) return 'pending';
  if (k.includes('work') || k === 'open') return 'working';
  return 'working';
}

function mapOrderType(s: unknown): OrderType {
  const k = String(s ?? '').toLowerCase();
  if (k === 'stoplimit' || k === 'stop_limit') return 'stop_limit';
  if (k === 'stop') return 'stop';
  if (k === 'limit') return 'limit';
  return 'market';
}

function mapOrderAction(s: unknown): FillAction {
  return String(s ?? '').toLowerCase().startsWith('s') ? 'sell' : 'buy';
}

function mapTimeInForce(s: unknown): TimeInForce {
  const k = String(s ?? '').toLowerCase();
  if (k === 'gtc') return 'gtc';
  if (k === 'ioc') return 'ioc';
  if (k === 'fok') return 'fok';
  return 'day';
}

function order_isRejected(s: unknown): boolean {
  return String(s ?? '').toLowerCase().includes('reject');
}
