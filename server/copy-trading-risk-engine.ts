import { recordLatency } from "./latency-monitor";
import type { CopyTradingGroup, CopyTradingFollower } from "@shared/copy-trading-schema";

export interface RiskCheckResult {
  passed: boolean;
  checks: RiskCheck[];
  blockReason?: string;
}

export interface RiskCheck {
  name: string;
  passed: boolean;
  reason?: string;
  value?: any;
  threshold?: any;
}

export interface RiskContext {
  group: CopyTradingGroup;
  follower: CopyTradingFollower;
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;
  masterPrice?: number;
  followerBalance?: number;
  followerSize?: number;
  followerMaxDrawdown?: number | null;
  availableMargin?: number | null;
  currentPrice?: number | null;
  tickSize?: number;
  quoteSource?: string;
  liveRiskPercent?: number | null;
}

const dailyLossCache = new Map<string, { date: string; totalLoss: number }>();

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

export function recordDailyLoss(groupId: number, followerId: number, loss: number): void {
  const key = `${groupId}:${followerId}`;
  const today = getTodayKey();
  const existing = dailyLossCache.get(key);
  if (existing && existing.date === today) {
    existing.totalLoss += loss;
  } else {
    dailyLossCache.set(key, { date: today, totalLoss: loss });
  }
  persistDailyLoss(groupId, followerId, loss).catch(err => {
    console.warn(`[RiskEngine] Failed to persist daily loss: ${err?.message || "unknown"}`);
  });
}

async function persistDailyLoss(groupId: number, followerId: number, loss: number): Promise<void> {
  try {
    const { db } = await import("./db");
    const today = getTodayKey();
    const key = `daily_loss_${groupId}_${followerId}_${today}`;
    await db.execute(
      `INSERT INTO copy_daily_loss (group_id, follower_id, trade_date, total_loss)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, follower_id, trade_date)
       DO UPDATE SET total_loss = copy_daily_loss.total_loss + $4`,
      [groupId, followerId, today, loss]
    );
  } catch (err: any) {
    console.warn(`[RiskEngine] Daily loss persistence error: ${err?.message || "unknown"}`);
  }
}

export async function loadDailyLossFromDB(groupId: number, followerId: number): Promise<number> {
  try {
    const { db } = await import("./db");
    const today = getTodayKey();
    const result = await db.execute(
      `SELECT total_loss FROM copy_daily_loss WHERE group_id = $1 AND follower_id = $2 AND trade_date = $3`,
      [groupId, followerId, today]
    );
    const rows = result.rows || result;
    if (Array.isArray(rows) && rows.length > 0) {
      return Number(rows[0].total_loss) || 0;
    }
  } catch (err: any) {
    console.warn(`[RiskEngine] Daily loss DB load failed: ${err?.message || "unknown"}`);
  }
  return 0;
}

export function getDailyLoss(groupId: number, followerId: number): number {
  const key = `${groupId}:${followerId}`;
  const today = getTodayKey();
  const existing = dailyLossCache.get(key);
  if (existing && existing.date === today) {
    return existing.totalLoss;
  }
  return 0;
}

export function getDailyLossTotal(groupId: number): number {
  const today = getTodayKey();
  let total = 0;
  for (const [key, val] of dailyLossCache.entries()) {
    if (key.startsWith(`${groupId}:`) && val.date === today) {
      total += val.totalLoss;
    }
  }
  return total;
}

export function resetDailyLoss(groupId: number, followerId: number): void {
  const key = `${groupId}:${followerId}`;
  dailyLossCache.delete(key);
}

export async function runRiskChecks(ctx: RiskContext): Promise<RiskCheckResult> {
  const riskStart = performance.now();
  const checks: RiskCheck[] = [];

  const restrictedCheck = checkRestrictedSymbols(ctx);
  checks.push(restrictedCheck);

  const allowedCheck = checkAllowedSymbols(ctx);
  checks.push(allowedCheck);

  const dailyLossCheck = await checkDailyLossLimit(ctx);
  checks.push(dailyLossCheck);

  const drawdownCheck = checkDrawdown(ctx);
  checks.push(drawdownCheck);

  const marginCheck = checkMargin(ctx);
  checks.push(marginCheck);

  const newsEmbargoCheck = checkNewsEmbargo(ctx);
  checks.push(newsEmbargoCheck);

  const slippageCheck = checkSlippage(ctx);
  checks.push(slippageCheck);

  const passed = checks.every(c => c.passed);
  const blockReason = checks.find(c => !c.passed)?.reason;

  recordLatency("risk", "check_latency", performance.now() - riskStart);

  if (!passed) {
    recordLatency("risk", "blocked_trades", 1);
  }

  return { passed, checks, blockReason };
}

function checkRestrictedSymbols(ctx: RiskContext): RiskCheck {
  const restricted = ctx.group.restrictedSymbols;
  if (!restricted || restricted.length === 0) {
    return { name: "restricted_symbols", passed: true };
  }
  const isRestricted = restricted.some(s =>
    ctx.symbol.toLowerCase().includes(s.toLowerCase())
  );
  if (isRestricted) {
    return {
      name: "restricted_symbols",
      passed: false,
      reason: `Symbol ${ctx.symbol} is in the restricted list`,
      value: ctx.symbol,
      threshold: restricted,
    };
  }
  return { name: "restricted_symbols", passed: true };
}

function checkAllowedSymbols(ctx: RiskContext): RiskCheck {
  if (!ctx.follower.allowedSymbols || ctx.follower.allowedSymbols.length === 0) {
    return { name: "allowed_symbols", passed: true };
  }
  const allowed = ctx.follower.allowedSymbols.some(s =>
    ctx.symbol.toLowerCase().includes(s.toLowerCase())
  );
  if (!allowed) {
    return {
      name: "allowed_symbols",
      passed: false,
      reason: `Symbol ${ctx.symbol} not in follower's allowed list`,
      value: ctx.symbol,
      threshold: ctx.follower.allowedSymbols,
    };
  }
  return { name: "allowed_symbols", passed: true };
}

async function checkDailyLossLimit(ctx: RiskContext): Promise<RiskCheck> {
  const limit = ctx.group.dailyLossLimit;
  if (!limit || limit <= 0) {
    return { name: "daily_loss_limit", passed: true };
  }
  let currentLoss = getDailyLoss(ctx.group.id, ctx.follower.id);
  if (currentLoss === 0) {
    const dbLoss = await loadDailyLossFromDB(ctx.group.id, ctx.follower.id);
    if (dbLoss > 0) {
      const key = `${ctx.group.id}:${ctx.follower.id}`;
      dailyLossCache.set(key, { date: getTodayKey(), totalLoss: dbLoss });
      currentLoss = dbLoss;
    }
  }
  if (currentLoss >= limit) {
    return {
      name: "daily_loss_limit",
      passed: false,
      reason: `Daily loss $${currentLoss.toFixed(2)} reached limit $${limit.toFixed(2)}`,
      value: currentLoss,
      threshold: limit,
    };
  }
  return {
    name: "daily_loss_limit",
    passed: true,
    value: { currentLoss, remaining: limit - currentLoss },
    threshold: limit,
  };
}

const LIVE_RISK_BLOCK_THRESHOLD = 0.95;

function checkDrawdown(ctx: RiskContext): RiskCheck {
  if (ctx.liveRiskPercent != null && ctx.liveRiskPercent >= LIVE_RISK_BLOCK_THRESHOLD) {
    recordLatency("risk", "drawdown_blocks", 1);
    return {
      name: "drawdown_check",
      passed: false,
      reason: `Live risk ${(ctx.liveRiskPercent * 100).toFixed(1)}% >= ${(LIVE_RISK_BLOCK_THRESHOLD * 100).toFixed(0)}% — signal dropped to protect account`,
      value: ctx.liveRiskPercent,
      threshold: LIVE_RISK_BLOCK_THRESHOLD,
    };
  }

  if (ctx.followerMaxDrawdown === null || ctx.followerMaxDrawdown === undefined ||
      ctx.followerBalance === null || ctx.followerBalance === undefined ||
      ctx.followerSize === null || ctx.followerSize === undefined) {
    return { name: "drawdown_check", passed: true };
  }
  const currentDrawdown = ctx.followerSize - ctx.followerBalance;
  const maxAllowed = ctx.followerMaxDrawdown;

  if (currentDrawdown >= maxAllowed) {
    recordLatency("risk", "drawdown_blocks", 1);
    return {
      name: "drawdown_check",
      passed: false,
      reason: `Drawdown limit breached: $${currentDrawdown.toFixed(2)} >= $${maxAllowed.toFixed(2)}`,
      value: currentDrawdown,
      threshold: maxAllowed,
    };
  }

  const eodWarningPct = 0.9;
  if (currentDrawdown >= maxAllowed * eodWarningPct) {
    recordLatency("risk", "drawdown_blocks", 1);
    return {
      name: "drawdown_check",
      passed: false,
      reason: `Near EOD drawdown limit: $${currentDrawdown.toFixed(2)} / $${maxAllowed.toFixed(2)} (${(eodWarningPct * 100).toFixed(0)}% threshold)`,
      value: currentDrawdown,
      threshold: maxAllowed * eodWarningPct,
    };
  }
  return {
    name: "drawdown_check",
    passed: true,
    value: { currentDrawdown, maxAllowed, pct: (currentDrawdown / maxAllowed * 100).toFixed(1) },
  };
}

function checkMargin(ctx: RiskContext): RiskCheck {
  if (ctx.availableMargin === null || ctx.availableMargin === undefined) {
    return { name: "margin_check", passed: true };
  }
  if (ctx.availableMargin <= 0) {
    return {
      name: "margin_check",
      passed: false,
      reason: `Insufficient margin: $${ctx.availableMargin.toFixed(2)}`,
      value: ctx.availableMargin,
    };
  }
  return { name: "margin_check", passed: true, value: ctx.availableMargin };
}

function checkNewsEmbargo(ctx: RiskContext): RiskCheck {
  const minutes = ctx.group.newsEmbargoMinutes;
  if (!minutes || minutes <= 0) {
    return { name: "news_embargo", passed: true };
  }
  const events = ctx.group.newsEmbargoEvents as Array<{ time: string; name: string }> | null;
  if (!events || events.length === 0) {
    return { name: "news_embargo", passed: true };
  }

  const now = Date.now();
  const windowMs = minutes * 60 * 1000;

  for (const event of events) {
    const eventTime = new Date(event.time).getTime();
    if (isNaN(eventTime)) continue;
    const diff = Math.abs(now - eventTime);
    if (diff <= windowMs) {
      return {
        name: "news_embargo",
        passed: false,
        reason: `News embargo active: "${event.name}" at ${event.time} (±${minutes}min window)`,
        value: { eventName: event.name, eventTime: event.time },
        threshold: minutes,
      };
    }
  }

  return { name: "news_embargo", passed: true };
}

function checkSlippage(ctx: RiskContext): RiskCheck {
  const hasSlippageGuard =
    (ctx.follower.maxSlippagePercent ?? ctx.group.maxSlippagePercent ?? null) !== null ||
    (ctx.follower.maxSlippageTicks ?? ctx.group.maxSlippageTicks ?? null) !== null;

  if (!ctx.masterPrice || ctx.masterPrice <= 0) {
    return { name: "slippage_check", passed: true };
  }

  if (hasSlippageGuard && (!ctx.currentPrice || ctx.currentPrice <= 0)) {
    recordLatency("risk", "slippage_blocks", 1);
    return {
      name: "slippage_check",
      passed: false,
      reason: "Slippage guard configured but no current price available — trade blocked as fail-safe",
    };
  }

  if (!ctx.currentPrice || ctx.currentPrice <= 0) {
    return { name: "slippage_check", passed: true };
  }

  const priceDiff = Math.abs(ctx.currentPrice - ctx.masterPrice);
  const tickSize = ctx.tickSize || 1;

  const isNonMarketQuote = ctx.quoteSource === "delayed" || ctx.quoteSource === "indicative";
  const toleranceMultiplier = isNonMarketQuote ? 2.0 : 1.0;

  const effectiveMaxSlippagePct = ctx.follower.maxSlippagePercent ?? ctx.group.maxSlippagePercent ?? null;
  if (effectiveMaxSlippagePct !== null && effectiveMaxSlippagePct > 0) {
    const slippagePct = (priceDiff / ctx.masterPrice) * 100;
    const adjustedThreshold = effectiveMaxSlippagePct * toleranceMultiplier;
    if (slippagePct > adjustedThreshold) {
      recordLatency("risk", "slippage_blocks", 1);
      return {
        name: "slippage_check",
        passed: false,
        reason: `Slippage ${slippagePct.toFixed(2)}% exceeds max ${adjustedThreshold.toFixed(2)}%${isNonMarketQuote ? " (non-market tolerance applied)" : ""}`,
        value: slippagePct,
        threshold: adjustedThreshold,
      };
    }
  }

  const effectiveMaxSlippageTicks = ctx.follower.maxSlippageTicks ?? ctx.group.maxSlippageTicks ?? null;
  if (effectiveMaxSlippageTicks !== null && effectiveMaxSlippageTicks > 0) {
    const slippageInTicks = priceDiff / tickSize;
    const adjustedTickThreshold = effectiveMaxSlippageTicks * toleranceMultiplier;
    if (slippageInTicks > adjustedTickThreshold) {
      recordLatency("risk", "slippage_blocks", 1);
      return {
        name: "slippage_check",
        passed: false,
        reason: `Slippage ${slippageInTicks.toFixed(1)} ticks exceeds max ${adjustedTickThreshold}${isNonMarketQuote ? " (non-market tolerance applied)" : ""}`,
        value: slippageInTicks,
        threshold: adjustedTickThreshold,
      };
    }
  }

  return { name: "slippage_check", passed: true };
}

export function normalizeErrorCode(providerKey: string, errorMessage: string): string {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("margin") || msg.includes("insufficient funds") || msg.includes("buying power")) {
    return "MARGIN_VIOLATION";
  }
  if (msg.includes("symbol not found") || msg.includes("contract not found") || msg.includes("invalid contract")) {
    return "SYMBOL_NOT_FOUND";
  }
  if (msg.includes("market closed") || msg.includes("outside trading hours") || msg.includes("market is closed")) {
    return "MARKET_CLOSED";
  }
  if (msg.includes("max position") || msg.includes("position limit") || msg.includes("too many contracts")) {
    return "POSITION_LIMIT";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("throttl")) {
    return "RATE_LIMITED";
  }
  if (msg.includes("rejected") || msg.includes("refused")) {
    return "ORDER_REJECTED";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "TIMEOUT";
  }
  if (msg.includes("auth") || msg.includes("unauthorized") || msg.includes("401") || msg.includes("403")) {
    return "AUTH_ERROR";
  }
  return "UNKNOWN_ERROR";
}

export function computeSlippage(
  masterPrice: number | undefined,
  followerFillPrice: number | undefined,
  tickSize: number
): { slippageTicks: number | null; slippageDollars: number | null } {
  if (!masterPrice || !followerFillPrice || masterPrice <= 0 || followerFillPrice <= 0) {
    return { slippageTicks: null, slippageDollars: null };
  }
  const priceDiff = Math.abs(followerFillPrice - masterPrice);
  const slippageTicks = tickSize > 0 ? priceDiff / tickSize : null;
  const slippageDollars = priceDiff;
  return {
    slippageTicks: slippageTicks !== null ? Math.round(slippageTicks * 100) / 100 : null,
    slippageDollars: Math.round(slippageDollars * 10000) / 10000,
  };
}

export interface BracketLeg {
  orderType: string;
  price?: number;
  stopPrice?: number;
  trailOffset?: number;
}

export interface OrderTypeMapping {
  orderType: string;
  limitPrice?: number;
  stopPrice?: number;
  trailOffset?: number;
  timeInForce?: string;
  bracketLegs?: BracketLeg[];
}

export function mapOrderTypeForBroker(
  providerKey: string,
  mapping: OrderTypeMapping
): Record<string, any> {
  const params: Record<string, any> = {};

  const compositeTypes = ["Bracket", "OCO", "OTO"];
  const isComposite = compositeTypes.includes(mapping.orderType);

  if (providerKey === "tradovate") {
    const typeMap: Record<string, string> = {
      Market: "Market",
      Limit: "Limit",
      Stop: "Stop",
      StopLimit: "StopLimit",
      TrailingStop: "TrailingStop",
      MIT: "MIT",
      Bracket: "Bracket",
      OCO: "OCO",
      OTO: "OTO",
    };
    params.orderType = typeMap[mapping.orderType] || "Market";
    params.isComposite = isComposite;
    if (mapping.limitPrice != null) params.price = mapping.limitPrice;
    if (mapping.stopPrice != null) params.stopPrice = mapping.stopPrice;
    if (mapping.trailOffset != null) params.trailOffset = mapping.trailOffset;
    if (mapping.bracketLegs) params.bracketLegs = mapping.bracketLegs;

    const tifMap: Record<string, string> = {
      Day: "Day",
      GTC: "GTC",
      GTD: "GTD",
      FOK: "FOK",
      IOC: "IOC",
    };
    if (mapping.timeInForce) {
      params.timeInForce = tifMap[mapping.timeInForce] || "Day";
    }
  } else if (providerKey === "topstepx") {
    const typeMap: Record<string, string> = {
      Market: "market",
      Limit: "limit",
      Stop: "stop",
      StopLimit: "stopLimit",
      TrailingStop: "trailingStop",
      Bracket: "bracket",
      OCO: "oco",
      OTO: "oto",
    };
    params.orderType = typeMap[mapping.orderType] || "market";
    params.isComposite = isComposite;
    if (mapping.limitPrice != null) params.price = mapping.limitPrice;
    if (mapping.stopPrice != null) params.stopPrice = mapping.stopPrice;
    if (mapping.trailOffset != null) params.trailOffset = mapping.trailOffset;
    if (mapping.bracketLegs) params.bracketLegs = mapping.bracketLegs;

    const tifMap: Record<string, string> = {
      Day: "day",
      GTC: "gtc",
      GTD: "gtd",
      FOK: "fok",
      IOC: "ioc",
    };
    if (mapping.timeInForce) {
      params.timeInForce = tifMap[mapping.timeInForce] || "day";
    }
  }

  return params;
}

export function applyAdvancedSizing(
  rawQty: number,
  follower: CopyTradingFollower
): number {
  if (follower.fixedLotSize && follower.fixedLotSize > 0) {
    rawQty = follower.fixedLotSize;
  }

  const rounding = follower.roundingLogic || "nearest";
  if (rounding === "floor") {
    rawQty = Math.floor(rawQty);
  } else if (rounding === "ceil") {
    rawQty = Math.ceil(rawQty);
  } else {
    rawQty = Math.round(rawQty);
  }

  if (follower.minPositionSize && follower.minPositionSize > 0) {
    if (rawQty < follower.minPositionSize) {
      rawQty = follower.minPositionSize;
    }
  } else if (rawQty < 1) {
    rawQty = 0;
  }

  if (follower.maxPositionSize && rawQty > follower.maxPositionSize) {
    rawQty = follower.maxPositionSize;
  }

  return Math.max(rawQty, 0);
}
