/**
 * Pure prop-firm math engine.
 *
 * Mirrors the manual Excel calculators (Consistency Rule, Risk Calculator,
 * Trading Journal). No DB access, no I/O, no imports from server/. Every
 * function is deterministic on its inputs and safe to call from anywhere.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. Consistency Rule
// ────────────────────────────────────────────────────────────────────────────

export interface ConsistencyInput {
  dailyPnl: number[];
  thresholdPct?: number;
}

export type ConsistencyStatus = 'safe' | 'warning' | 'no_profit';

export interface ConsistencyResult {
  bestDay: number;
  totalProfit: number;
  consistencyPct: number;
  status: ConsistencyStatus;
  threshold: number;
}

export function evaluateConsistency(input: ConsistencyInput): ConsistencyResult {
  const threshold = input.thresholdPct ?? 0.4;

  if (input.dailyPnl.length === 0) {
    return { bestDay: 0, totalProfit: 0, consistencyPct: 0, status: 'no_profit', threshold };
  }

  const totalProfit = input.dailyPnl.reduce((acc, d) => acc + d, 0);
  const bestDay = input.dailyPnl.reduce((max, d) => (d > max ? d : max), 0);

  if (totalProfit <= 0 || bestDay <= 0) {
    return { bestDay, totalProfit, consistencyPct: 0, status: 'no_profit', threshold };
  }

  const consistencyPct = bestDay / totalProfit;
  const status: ConsistencyStatus = consistencyPct <= threshold ? 'safe' : 'warning';

  return { bestDay, totalProfit, consistencyPct, status, threshold };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Trade Stats (from Trading Journal)
// ────────────────────────────────────────────────────────────────────────────

export type TradeOutcome = 'win' | 'loss' | 'breakeven';

export interface TradeRecord {
  pnl: number;
  result: TradeOutcome;
}

export interface TradeStatsResult {
  wins: number;
  losses: number;
  breakevens: number;
  totalTrades: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  riskReward: number;
  netPnl: number;
}

export function computeTradeStats(trades: TradeRecord[]): TradeStatsResult {
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let sumWinPnl = 0;
  let sumLossAbs = 0;
  let netPnl = 0;

  for (const t of trades) {
    netPnl += t.pnl;
    if (t.result === 'win') {
      wins += 1;
      sumWinPnl += t.pnl;
    } else if (t.result === 'loss') {
      losses += 1;
      sumLossAbs += Math.abs(t.pnl);
    } else {
      breakevens += 1;
    }
  }

  const decisive = wins + losses;
  const winRatePct = decisive === 0 ? 0 : (wins / decisive) * 100;
  const avgWin = wins === 0 ? 0 : sumWinPnl / wins;
  const avgLoss = losses === 0 ? 0 : sumLossAbs / losses;
  const riskReward = avgLoss === 0 ? 0 : avgWin / avgLoss;

  return {
    wins,
    losses,
    breakevens,
    totalTrades: trades.length,
    winRatePct,
    avgWin,
    avgLoss,
    riskReward,
    netPnl,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Drawdown Status
// ────────────────────────────────────────────────────────────────────────────

export type DrawdownType = 'trailing' | 'static';

export interface DrawdownInput {
  accountSize: number;
  peakBalance: number;
  currentEquity: number;
  drawdownLimit: number;
  drawdownType: DrawdownType;
  targetProfit: number;
}

export type DrawdownStatus = 'passed' | 'violated' | 'active';

export interface DrawdownResult {
  status: DrawdownStatus;
  floor: number;
  distanceToFloor: number;
  pnl: number;
  reachedTarget: boolean;
  breached: boolean;
}

export function evaluateDrawdown(input: DrawdownInput): DrawdownResult {
  const { accountSize, peakBalance, currentEquity, drawdownLimit, drawdownType, targetProfit } = input;

  const floor =
    drawdownType === 'static'
      ? accountSize - drawdownLimit
      : Math.min(peakBalance - drawdownLimit, accountSize);

  const pnl = currentEquity - accountSize;
  const breached = currentEquity <= floor;
  const reachedTarget = pnl >= targetProfit;

  let status: DrawdownStatus;
  if (breached) status = 'violated';
  else if (reachedTarget) status = 'passed';
  else status = 'active';

  return {
    status,
    floor,
    distanceToFloor: currentEquity - floor,
    pnl,
    reachedTarget,
    breached,
  };
}
