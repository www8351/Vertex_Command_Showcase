import type { Firm, FirmTier } from "@shared/schema";
import { storage } from "./storage";
import { computeTrailingDrawdownState } from "./trailing-drawdown";
import {
  evaluateConsistency,
  evaluateDrawdown,
  computeTradeStats,
  type ConsistencyResult,
  type TradeStatsResult,
} from "./utils/prop-calculator";

export function resolveRules(account: any, firm: Firm | undefined, tiers: FirmTier[]): any {
  if (account.tier && tiers.length > 0) {
    const tier = tiers.find(t => t.name === account.tier);
    if (tier) return tier;
  }
  return firm || {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group imported trades by calendar day (UTC) and sum realizedPnl per day.
 * Returns an ordered array of daily P&L values ready for evaluateConsistency.
 */
function buildDailyPnl(
  trades: Array<{ realizedPnl: number | null; closedAt: Date | string | null }>
): number[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.realizedPnl == null || t.closedAt == null) continue;
    const day = new Date(t.closedAt).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + t.realizedPnl);
  }
  return Array.from(byDay.values());
}

/**
 * Map raw ImportedTrade rows into the TradeRecord shape our engine expects.
 * Win/Loss is derived from realizedPnl sign (no separate result column exists).
 */
function tradesToTradeRecords(
  trades: Array<{ realizedPnl: number | null }>
): Parameters<typeof computeTradeStats>[0] {
  return trades
    .filter(t => t.realizedPnl != null)
    .map(t => ({
      pnl: t.realizedPnl!,
      result:
        t.realizedPnl! > 0 ? ("win" as const)
        : t.realizedPnl! < 0 ? ("loss" as const)
        : ("breakeven" as const),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public exports: rich calculators for the frontend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a ConsistencyResult for an account given its full daily P&L history.
 * Call this from API routes that need to render the consistency panel.
 */
export function computeConsistencyInfo(
  account: any,
  rules: any,
  dailyPnl: number[]
): ConsistencyResult {
  const consistencyRule: number = account.consistencyRule || rules?.consistencyPercentage || 0;
  return evaluateConsistency({
    dailyPnl,
    thresholdPct: consistencyRule > 0 ? consistencyRule / 100 : 0.4,
  });
}

/**
 * Convenience wrapper: groups raw trades by day then runs computeConsistencyInfo.
 * Use this in API routes that already have accountTrades loaded.
 */
export function computeConsistencyFromTrades(
  account: any,
  rules: any,
  trades: Array<{ realizedPnl: number | null; closedAt: Date | string | null }>
): ConsistencyResult {
  return computeConsistencyInfo(account, rules, buildDailyPnl(trades));
}

/**
 * Convenience wrapper: derives _tradeCount + dailyPnl from raw trades, then runs
 * computeAccountStatus. Replaces the manual accWithTradeCount dance in API routes.
 */
export function computeAccountStatusFromTrades(
  account: any,
  rules: any,
  trades: Array<{ realizedPnl: number | null; closedAt: Date | string | null }>
): string {
  const dailyPnl = account.dataSource === 'integration' ? buildDailyPnl(trades) : undefined;
  const accountWithMeta =
    account.dataSource === 'integration'
      ? { ...account, _tradeCount: trades.length }
      : account;
  return computeAccountStatus(accountWithMeta, rules, dailyPnl);
}

/**
 * Returns a TradeStatsResult (wins, losses, win rate, R:R, net P&L) for an account.
 * Call this from API routes that need to render the trade-stats panel.
 */
export function computeAccountTradeStats(
  trades: Array<{ realizedPnl: number | null }>
): TradeStatsResult {
  return computeTradeStats(tradesToTradeRecords(trades));
}

// ─────────────────────────────────────────────────────────────────────────────
// computeAccountStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the current status string for an account.
 *
 * Pass `dailyPnl` (grouped EOD P&L per calendar day) to enable the
 * evaluateConsistency-backed check. Without it, the function falls back to
 * the scalar topDayProfit field already stored on the account row.
 */
export function computeAccountStatus(account: any, rules: any, dailyPnl?: number[]): string {
  if (account.dataSource === 'integration' && account._tradeCount === 0 && account.balance !== account.size) {
    return 'sync_failed';
  }

  const baseline = account.startingBalance ?? account.size;
  const profit = account.balance - baseline;
  const maxDrawdown = account.maxDrawdown || rules?.totalDrawdown || 0;
  const target = account.target || 0;
  const consistencyRule: number = account.consistencyRule || rules?.consistencyPercentage || 0;
  const topDayProfit = account.topDayProfit || 0;

  const drawdownType = account.drawdownType || rules?.drawdownType || 'static';
  const trailingAmount = account.trailingDrawdown || rules?.trailingDrawdown || maxDrawdown;

  // Passed evaluation: profit target reached during an evaluation stage.
  // Checked before drawdown/violation rules so a successful combine pass is never
  // misclassified as a breach. Sticky lowest_equity from intraday during a winning
  // run can make trailing DD appear breached even when the firm passed the account.
  // Restricted to evaluation-like stages so funded/payout accounts hitting target
  // stay on the ready_to_withdraw path. Stage matching is case- and separator-
  // insensitive: "Phase 1", "phase_1", "PHASE-1", "evaluation 2", "Combine" all match.
  const evaluationStages = new Set([
    'phase1', 'phase2', 'phase3',
    'evaluation', 'evaluation1', 'evaluation2', 'evaluation3',
    'combine', 'combine1', 'combine2',
  ]);
  const normalizedStage = String(account.stage || '').toLowerCase().replace(/[\s_\-]/g, '');
  if (target > 0 && profit >= target && evaluationStages.has(normalizedStage)) {
    return 'passed';
  }

  let distanceToViolation: number;
  if (drawdownType === 'trailing' && trailingAmount > 0) {
    const peakBalance = account.peakBalance || account.size;
    const state = computeTrailingDrawdownState(account.size, trailingAmount, account.balance, peakBalance, account.lowestEquity);
    if (state.breachedByLow) return 'violated';
    distanceToViolation = state.distanceToStop;
  } else {
    // Use evaluateDrawdown for the static case so all floor math lives in one place.
    const dd = evaluateDrawdown({
      accountSize: account.size,
      peakBalance: account.peakBalance || account.balance,
      currentEquity: account.balance,
      drawdownLimit: maxDrawdown,
      drawdownType: 'static',
      targetProfit: target,
    });
    if (dd.breached) return 'violated';
    distanceToViolation = maxDrawdown > 0 ? dd.distanceToFloor : Infinity;
  }

  const effectiveDrawdown = drawdownType === 'trailing' ? trailingAmount : maxDrawdown;

  if (account.stage === 'inactive') return 'inactive';
  // True breach: equity at or below the floor. Anything above is at-risk only.
  // Previously the 10% proximity band fired 'violated' on a healthy account that
  // was simply close to its floor — that produced false positives on accounts
  // recovering from intraday dips.
  if (distanceToViolation <= 0) return 'violated';
  if (effectiveDrawdown > 0 && distanceToViolation <= effectiveDrawdown * 0.1) return 'drawdown_risk';
  if (effectiveDrawdown > 0 && distanceToViolation <= effectiveDrawdown * 0.3) return 'drawdown_risk';

  // Consistency check — use evaluateConsistency when full daily P&L is available,
  // otherwise fall back to the scalar topDayProfit already stored on the account.
  if (consistencyRule > 0 && profit > 0) {
    if (dailyPnl && dailyPnl.length > 0) {
      const consistency = evaluateConsistency({
        dailyPnl,
        thresholdPct: consistencyRule / 100,
      });
      if (consistency.status === 'warning') return 'consistency_risk';
    } else {
      const consistencyPercent = (topDayProfit / profit) * 100;
      if (consistencyPercent > consistencyRule) return 'consistency_risk';
    }
  }

  const bufferAdjustedProfit = account.bufferEnabled !== false ? Math.max(0, profit - effectiveDrawdown) : profit;
  if (target > 0 && bufferAdjustedProfit >= target) return 'ready_to_withdraw';
  if (target > 0 && bufferAdjustedProfit >= target * 0.8) return 'near_target';
  if (account.bufferEnabled !== false && effectiveDrawdown > 0 && profit > 0 && profit < effectiveDrawdown) return 'buffer_building';

  return 'healthy';
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDrawdownInfo
// ─────────────────────────────────────────────────────────────────────────────

export function computeDrawdownInfo(account: any, rules: any) {
  const drawdownType = account.drawdownType || rules?.drawdownType || 'static';
  const maxDrawdown = account.maxDrawdown || rules?.totalDrawdown || 0;
  const trailingAmount = account.trailingDrawdown || rules?.trailingDrawdown || maxDrawdown;
  const baseline = account.startingBalance ?? account.size;
  const profit = account.balance - baseline;

  const trailingStopType = account.trailingStopType || rules?.trailingStopType || 'intraday';

  if (drawdownType === 'trailing' && trailingAmount > 0) {
    // Keep computeTrailingDrawdownState for trailing: it tracks lowestEquity and
    // intraday breach (breachedByLow), which our end-of-day engine does not model.
    const peakBalance = account.peakBalance || account.size;
    const state = computeTrailingDrawdownState(account.size, trailingAmount, account.balance, peakBalance, account.lowestEquity);
    return {
      drawdownType,
      trailingAmount,
      trailingStopType,
      drawdownFloor: state.trailingStop,
      rawStop: state.rawStop,
      distanceToFloor: state.distanceToStop,
      drawdownRisk: state.drawdownRisk,
      peakBalance: state.hwm,
      lowestEquity: state.lowestEquity,
      breachedByLow: state.breachedByLow,
      locked: state.locked,
    };
  }

  // Static drawdown — delegate floor/distance/breach to evaluateDrawdown.
  const dd = evaluateDrawdown({
    accountSize: account.size,
    peakBalance: account.peakBalance || account.balance,
    currentEquity: account.balance,
    drawdownLimit: maxDrawdown,
    drawdownType: 'static',
    targetProfit: account.target || 0,
  });

  const drawdownRisk = maxDrawdown > 0 ? Math.max(0, (-profit / maxDrawdown) * 100) : 0;

  return {
    drawdownType: 'static',
    trailingAmount: maxDrawdown,
    trailingStopType,
    drawdownFloor: dd.floor,
    rawStop: dd.floor,
    distanceToFloor: maxDrawdown > 0 ? dd.distanceToFloor : Infinity,
    drawdownRisk,
    peakBalance: account.peakBalance || account.balance,
    locked: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeTradingPriority — unchanged logic, reads computeDrawdownInfo result
// ─────────────────────────────────────────────────────────────────────────────

export function computeTradingPriority(account: any, rules: any): { score: number; recommendation: string; drawdownRisk: number } {
  const baseline = account.startingBalance ?? account.size;
  const profit = account.balance - baseline;
  const target = account.target || 0;
  const consistencyRule: number = account.consistencyRule || rules?.consistencyPercentage || 0;
  const topDayProfit = account.topDayProfit || 0;

  const ddInfo = computeDrawdownInfo(account, rules);
  const effectiveDrawdown = ddInfo.trailingAmount || 0;
  const bufferAdjustedProfit = account.bufferEnabled !== false ? Math.max(0, profit - effectiveDrawdown) : profit;

  let score = 50;
  let recommendation = 'trade';

  if (target > 0 && bufferAdjustedProfit >= target) {
    score = 100;
    recommendation = 'ready_to_withdraw';
  } else if (target > 0 && bufferAdjustedProfit >= target * 0.8) {
    score = 85;
    recommendation = 'light_trading';
  }

  if (ddInfo.drawdownRisk > 70) {
    score = Math.min(score, 10);
    recommendation = 'do_not_trade';
  } else if (ddInfo.drawdownRisk > 50) {
    score = Math.min(score, 25);
    recommendation = 'avoid';
  }

  if (consistencyRule > 0 && profit > 0) {
    const cp = (topDayProfit / profit) * 100;
    if (cp > consistencyRule) {
      score = Math.min(score, 30);
      recommendation = 'light_trading';
    }
  }

  if (profit < 0) {
    score = Math.max(score - 20, 10);
  }

  return { score, recommendation, drawdownRisk: ddInfo.drawdownRisk };
}

// ─────────────────────────────────────────────────────────────────────────────
// Async recalculation — now passes dailyPnl into computeAccountStatus
// ─────────────────────────────────────────────────────────────────────────────

export async function recalculateAccountStatus(accountId: number): Promise<string> {
  const account = await storage.getAccount(accountId);
  if (!account) return 'unknown';

  const firm = await storage.getFirmByName(account.firm);
  const firmTiersList = firm ? await storage.getFirmTiersByFirmId(firm.id) : [];
  const rules = resolveRules(account, firm, firmTiersList);

  const accountWithMeta: any = { ...account };
  let dailyPnl: number[] | undefined;

  if (account.dataSource === 'integration') {
    const trades = await storage.getTradesByAccount(accountId);
    accountWithMeta._tradeCount = trades.length;
    dailyPnl = buildDailyPnl(trades);
  }

  const newStatus = computeAccountStatus(accountWithMeta, rules, dailyPnl);

  if (newStatus !== account.status) {
    await storage.updateAccount(accountId, { status: newStatus });
  }

  return newStatus;
}

export function isAccountSyncEligible(account: { status?: string | null; stage?: string | null }): boolean {
  if (account.status === 'sync_failed') return true;
  return account.status !== 'violated' && account.status !== 'passed' && account.stage !== 'inactive';
}

export async function recalculateAccountsForUser(userId: number): Promise<void> {
  const accounts = await storage.getAccounts(userId);
  const firmsList = await storage.getFirms();
  const allTiers = await storage.getFirmTiers();
  const firmsMap = Object.fromEntries(firmsList.map(f => [f.name, f]));

  for (const acc of accounts) {
    const firm = firmsMap[acc.firm];
    const firmTiersList = firm ? allTiers.filter(t => t.firmId === firm.id) : [];
    const rules = resolveRules(acc, firm, firmTiersList);

    const accountWithMeta: any = { ...acc };
    let dailyPnl: number[] | undefined;

    if (acc.dataSource === 'integration') {
      const trades = await storage.getTradesByAccount(acc.id);
      accountWithMeta._tradeCount = trades.length;
      dailyPnl = buildDailyPnl(trades);
    }

    const newStatus = computeAccountStatus(accountWithMeta, rules, dailyPnl);

    if (newStatus !== acc.status) {
      await storage.updateAccount(acc.id, { status: newStatus });
    }
  }
}
