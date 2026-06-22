import { storage } from "./storage";
import { computeTrailingDrawdownState } from "./trailing-drawdown";
import { onBreachDetected } from "./risk-enforcer";
import type { Account } from "@shared/schema";

const MIN_EQUITY_CHANGE_ABS = 1;
const MIN_EQUITY_CHANGE_PCT = 0.0001;
const ALERT_THRESHOLD_WARNING = 80;
const ALERT_THRESHOLD_CRITICAL = 90;
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface TelemetryPayload {
  type: "equityUpdate";
  riskPercent: number;
  dailyPnL: number;
  status: "healthy" | "risk" | "breached";
}

export function calculateRiskTelemetry(
  currentEquity: number,
  eodDrawdownLimit: number,
  startOfDayEquity: number
): TelemetryPayload {
  const allowedDrawdown = startOfDayEquity - eodDrawdownLimit;

  if (allowedDrawdown <= 0) {
    return {
      type: "equityUpdate",
      riskPercent: 1.0,
      dailyPnL: currentEquity - startOfDayEquity,
      status: "breached",
    };
  }

  const distanceToLimit = currentEquity - eodDrawdownLimit;
  const rawRisk = 1.0 - distanceToLimit / allowedDrawdown;
  const riskPercent = Math.max(0.0, Math.min(1.0, rawRisk));

  let status: "healthy" | "risk" | "breached" = "healthy";
  if (riskPercent >= 1.0) status = "breached";
  else if (riskPercent >= 0.8) status = "risk";

  return {
    type: "equityUpdate",
    riskPercent,
    dailyPnL: currentEquity - startOfDayEquity,
    status,
  };
}

const lastRecordedEquity = new Map<number, number>();
const lastAlertLevel = new Map<number, string>();
const EQUITY_MAP_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

async function sweepStaleEquityEntries() {
  try {
    const allAccounts = await storage.getAllAccounts();
    const activeIds = new Set(allAccounts.map(a => a.id));
    const equityKeysToDelete: number[] = [];
    const alertKeysToDelete: number[] = [];
    lastRecordedEquity.forEach((_, id) => {
      if (!activeIds.has(id)) equityKeysToDelete.push(id);
    });
    lastAlertLevel.forEach((_, id) => {
      if (!activeIds.has(id)) alertKeysToDelete.push(id);
    });
    equityKeysToDelete.forEach(id => lastRecordedEquity.delete(id));
    alertKeysToDelete.forEach(id => lastAlertLevel.delete(id));
  } catch {}
}

setInterval(sweepStaleEquityEntries, EQUITY_MAP_CLEANUP_INTERVAL_MS);

export function getEquityMapSizes(): { lastRecordedEquity: number; lastAlertLevel: number } {
  return { lastRecordedEquity: lastRecordedEquity.size, lastAlertLevel: lastAlertLevel.size };
}

function computeStaticDrawdownState(
  startingBalance: number,
  maxDrawdown: number,
  currentEquity: number
): { hwm: number; trailingStop: number; distanceToStop: number; drawdownRisk: number } {
  const fixedStop = startingBalance - maxDrawdown;
  const distanceToStop = currentEquity - fixedStop;
  const drawdownRisk = maxDrawdown > 0 ? Math.min(100, Math.max(0, (1 - distanceToStop / maxDrawdown) * 100)) : 0;
  return { hwm: startingBalance, trailingStop: fixedStop, distanceToStop, drawdownRisk };
}

function computeDrawdownState(
  drawdownType: string,
  startingBalance: number,
  maxDrawdown: number,
  currentEquity: number,
  peakBalance: number,
  lowestEquity?: number | null
): { hwm: number; trailingStop: number; distanceToStop: number; drawdownRisk: number; breachedByLow: boolean } {
  if (drawdownType === "trailing") {
    const state = computeTrailingDrawdownState(startingBalance, maxDrawdown, currentEquity, peakBalance, lowestEquity);
    return {
      hwm: state.hwm,
      trailingStop: state.trailingStop,
      distanceToStop: state.distanceToStop,
      drawdownRisk: Math.min(100, Math.max(0, state.drawdownRisk)),
      breachedByLow: state.breachedByLow,
    };
  }
  const staticState = computeStaticDrawdownState(startingBalance, maxDrawdown, currentEquity);
  const effectiveLowest = lowestEquity != null ? Math.min(lowestEquity, currentEquity) : currentEquity;
  return { ...staticState, breachedByLow: effectiveLowest <= staticState.trailingStop };
}

export interface EquityTickResult {
  breached: boolean;
  alertLevel?: string;
  telemetry?: TelemetryPayload;
  userId?: number;
}

export async function processEquityTick(
  accountId: number,
  currentEquity: number,
  timestamp?: Date
): Promise<EquityTickResult> {
  const account = await storage.getAccount(accountId);
  if (!account) return { breached: false };

  const drawdownType = account.drawdownType || "static";
  const maxDrawdown = drawdownType === "trailing"
    ? (account.trailingDrawdown || account.maxDrawdown || 0)
    : (account.maxDrawdown || 0);
  if (maxDrawdown <= 0) return { breached: false };

  const peakBalance = Math.max(account.peakBalance || account.size, currentEquity);
  const startingBalance = account.size;
  const prevLowest = account.lowestEquity ?? account.size;
  const lowestEquity = Math.min(prevLowest, currentEquity);

  const state = computeDrawdownState(drawdownType, startingBalance, maxDrawdown, currentEquity, peakBalance, lowestEquity);
  const breached = currentEquity <= state.trailingStop || state.breachedByLow;

  const eodDrawdownLimit = state.trailingStop;
  const startOfDayEquity = drawdownType === "trailing" ? state.hwm : startingBalance;
  const telemetry = calculateRiskTelemetry(currentEquity, eodDrawdownLimit, startOfDayEquity);

  const lastEquity = lastRecordedEquity.get(accountId) ?? account.balance;
  const change = Math.abs(currentEquity - lastEquity);
  const changePct = lastEquity > 0 ? change / lastEquity : 0;
  const shouldRecordTick = change >= MIN_EQUITY_CHANGE_ABS || changePct >= MIN_EQUITY_CHANGE_PCT || breached;

  const accountUpdate: Record<string, any> = { balance: currentEquity, lowestEquity };
  if (currentEquity > (account.peakBalance || account.size)) {
    accountUpdate.peakBalance = currentEquity;
  }
  await storage.updateAccount(accountId, accountUpdate);

  if (!shouldRecordTick) {
    return { breached: false, telemetry, userId: account.userId };
  }

  const tickTimestamp = timestamp || new Date();

  await storage.createEquityTick({
    accountId,
    timestamp: tickTimestamp,
    equity: currentEquity,
    hwm: state.hwm,
    trailingStop: state.trailingStop,
    drawdownRisk: state.drawdownRisk,
    breached,
    userId: account.userId,
  });

  lastRecordedEquity.set(accountId, currentEquity);

  let alertLevel: string | undefined;

  if (breached) {
    alertLevel = "breached";
    await storage.updateAccount(accountId, { status: "violated" });
    onBreachDetected(accountId, {
      hwm: state.hwm,
      currentEquity,
      eodLimit: state.trailingStop,
      riskPercent: telemetry.riskPercent,
    }).catch(err => console.error(`[RiskEnforcer] Unhandled error for account ${accountId}:`, err.message));
    await createDrawdownAlert(account, "breached", state.drawdownRisk, currentEquity, state.trailingStop)
      .catch(err => console.warn(`[EquityTick] Alert write failed for account ${accountId}:`, err.message));
  } else if (state.drawdownRisk >= ALERT_THRESHOLD_CRITICAL) {
    alertLevel = "critical";
    const prevLevel = lastAlertLevel.get(accountId);
    if (prevLevel !== "critical" && prevLevel !== "breached") {
      await createDrawdownAlert(account, "critical", state.drawdownRisk, currentEquity, state.trailingStop);
    }
  } else if (state.drawdownRisk >= ALERT_THRESHOLD_WARNING) {
    alertLevel = "warning";
    const prevLevel = lastAlertLevel.get(accountId);
    if (!prevLevel || prevLevel === "safe") {
      await createDrawdownAlert(account, "warning", state.drawdownRisk, currentEquity, state.trailingStop);
    }
  } else {
    alertLevel = "safe";
  }

  if (alertLevel) {
    lastAlertLevel.set(accountId, alertLevel);
  }

  return { breached, alertLevel, telemetry, userId: account.userId };
}

async function createDrawdownAlert(
  account: Account,
  level: "warning" | "critical" | "breached",
  drawdownRisk: number,
  equity: number,
  trailingStop: number
) {
  const severityMap = { warning: "medium", critical: "high", breached: "critical" } as const;
  const titleMap = {
    warning: `Drawdown Warning: ${account.name}`,
    critical: `CRITICAL Drawdown: ${account.name}`,
    breached: `BREACH DETECTED: ${account.name}`,
  };
  const messageMap = {
    warning: `Account ${account.name} is at ${drawdownRisk.toFixed(1)}% drawdown risk. Equity: $${equity.toLocaleString()}, Trailing Stop: $${trailingStop.toLocaleString()}`,
    critical: `Account ${account.name} is at ${drawdownRisk.toFixed(1)}% drawdown risk! Equity: $${equity.toLocaleString()}, Trailing Stop: $${trailingStop.toLocaleString()}. Immediate attention required.`,
    breached: `Account ${account.name} has BREACHED the drawdown limit! Equity: $${equity.toLocaleString()} fell below Stop: $${trailingStop.toLocaleString()}. Account marked as violated.`,
  };

  await storage.createAlert({
    accountId: account.id,
    type: "drawdown",
    severity: severityMap[level],
    title: titleMap[level],
    message: messageMap[level],
    userId: account.userId,
  });
}

export function startEquityTickCleanup() {
  setInterval(async () => {
    try {
      const deleted = await storage.deleteOldEquityTicks(RETENTION_DAYS);
      if (deleted > 0) {
        console.log(`[EquityTickProcessor] Cleaned up ${deleted} old equity ticks (>${RETENTION_DAYS} days)`);
      }
    } catch (err: any) {
      console.error(`[EquityTickProcessor] Cleanup error:`, err.message);
    }
  }, CLEANUP_INTERVAL_MS);
}

const backfillInProgress = new Set<number>();

export async function backfillEquityTicksFromTrades(accountId: number): Promise<number> {
  if (backfillInProgress.has(accountId)) return 0;
  backfillInProgress.add(accountId);

  try {
    const account = await storage.getAccount(accountId);
    if (!account) return 0;

    const drawdownType = account.drawdownType || "static";
    const maxDrawdown = drawdownType === "trailing"
      ? (account.trailingDrawdown || account.maxDrawdown || 0)
      : (account.maxDrawdown || 0);
    if (maxDrawdown <= 0) return 0;

    const trades = await storage.getTradesByAccount(accountId);
    if (trades.length === 0) {
      const existingCount = await storage.getEquityTickCount(accountId);
      if (existingCount === 0) {
        const currentEquity = account.balance || account.size;
        const peakBal = account.peakBalance || account.size;
        const lowEq = account.lowestEquity ?? currentEquity;
        const startState = computeDrawdownState(drawdownType, account.size, maxDrawdown, currentEquity, peakBal, lowEq);
        await storage.createEquityTick({
          accountId,
          timestamp: account.createdAt || new Date(),
          equity: currentEquity,
          hwm: startState.hwm,
          trailingStop: startState.trailingStop,
          drawdownRisk: startState.drawdownRisk,
          breached: false,
          userId: account.userId,
        });
        return 1;
      }
      return 0;
    }

    const sortedTrades = [...trades]
      .filter(t => t.realizedPnl != null)
      .sort((a, b) => {
        const timeA = (a.closedAt || a.openedAt || new Date(0)).getTime();
        const timeB = (b.closedAt || b.openedAt || new Date(0)).getTime();
        return timeA - timeB;
      });

    if (sortedTrades.length === 0) return 0;

    const existingTicks = await storage.getEquityTicks(accountId, undefined, undefined, 100000);
    const existingTimestamps = new Set(existingTicks.map(t => new Date(t.timestamp).getTime()));

    const startingBalance = account.size;
    let runningBalance = startingBalance;
    let peakBalance = startingBalance;
    let lowestEquity = startingBalance;
    let tickCount = 0;

    const firstTradeTime = sortedTrades[0].closedAt || sortedTrades[0].openedAt || account.createdAt || new Date();
    const startTime = new Date(new Date(firstTradeTime).getTime() - 1000);
    const startTimeMs = startTime.getTime();

    if (!existingTimestamps.has(startTimeMs)) {
      const startState = computeDrawdownState(drawdownType, startingBalance, maxDrawdown, startingBalance, startingBalance, startingBalance);
      await storage.createEquityTick({
        accountId,
        timestamp: startTime,
        equity: startingBalance,
        hwm: startState.hwm,
        trailingStop: startState.trailingStop,
        drawdownRisk: startState.drawdownRisk,
        breached: false,
        userId: account.userId,
      });
      existingTimestamps.add(startTimeMs);
      tickCount++;
    }

    for (const trade of sortedTrades) {
      runningBalance += trade.realizedPnl!;
      const tradeTime = new Date(trade.closedAt || trade.openedAt || new Date());
      peakBalance = Math.max(peakBalance, runningBalance);
      lowestEquity = Math.min(lowestEquity, runningBalance);

      const tradeTimeMs = tradeTime.getTime();
      if (existingTimestamps.has(tradeTimeMs)) continue;

      const state = computeDrawdownState(
        drawdownType, startingBalance, maxDrawdown,
        runningBalance, peakBalance, lowestEquity
      );

      const breached = runningBalance <= state.trailingStop || state.breachedByLow;

      await storage.createEquityTick({
        accountId,
        timestamp: tradeTime,
        equity: Math.round(runningBalance * 100) / 100,
        hwm: state.hwm,
        trailingStop: state.trailingStop,
        drawdownRisk: Math.min(100, Math.max(0, state.drawdownRisk)),
        breached,
        userId: account.userId,
      });
      existingTimestamps.add(tradeTimeMs);
      tickCount++;
    }

    if (tickCount > 0) {
      await storage.updateAccount(accountId, {
        peakBalance: Math.max(peakBalance, account.peakBalance || startingBalance),
        lowestEquity: Math.min(lowestEquity, account.lowestEquity ?? startingBalance),
      });
      console.log(`[EquityBackfill] Account ${account.name} (${accountId}): inserted ${tickCount} backfill ticks from ${sortedTrades.length} trades (preserved ${existingTicks.length} existing ticks)`);
    }

    return tickCount;
  } finally {
    backfillInProgress.delete(accountId);
  }
}

export async function backfillAllAccounts(): Promise<void> {
  try {
    const allAccounts = await storage.getAllAccounts();
    let backfilledCount = 0;

    for (const account of allAccounts) {
      try {
        const ticks = await backfillEquityTicksFromTrades(account.id);
        if (ticks > 0) backfilledCount++;
      } catch (err: any) {
        console.error(`[EquityBackfill] Error backfilling account ${account.id}: ${err.message}`);
      }
    }

    if (backfilledCount > 0) {
      console.log(`[EquityBackfill] Backfilled ${backfilledCount} accounts at startup`);
    }
  } catch (err: any) {
    console.error(`[EquityBackfill] Startup backfill error:`, err.message);
  }
}

export async function getDrawdownStatusForAccounts(userId: number): Promise<any[]> {
  const userAccounts = await storage.getAccounts(userId);
  const results = [];

  for (const account of userAccounts) {
    const drawdownType = account.drawdownType || "static";
    const maxDrawdown = drawdownType === "trailing"
      ? (account.trailingDrawdown || account.maxDrawdown || 0)
      : (account.maxDrawdown || 0);
    if (maxDrawdown <= 0) continue;

    const latestTick = await storage.getLatestEquityTick(account.id);
    const peakBalance = account.peakBalance || account.size;
    const currentEquity = latestTick?.equity || account.balance;
    const lowestEquity = account.lowestEquity ?? currentEquity;

    const state = computeDrawdownState(drawdownType, account.size, maxDrawdown, currentEquity, peakBalance, lowestEquity);

    let status: string;
    if (currentEquity <= state.trailingStop || state.breachedByLow) status = "breached";
    else if (state.drawdownRisk >= ALERT_THRESHOLD_CRITICAL) status = "critical";
    else if (state.drawdownRisk >= ALERT_THRESHOLD_WARNING) status = "warning";
    else status = "safe";

    results.push({
      accountId: account.id,
      accountName: account.name,
      firm: account.firm,
      startingBalance: account.size,
      currentEquity,
      lowestEquity,
      hwm: state.hwm,
      trailingStop: state.trailingStop,
      drawdownRisk: state.drawdownRisk,
      distanceToStop: state.distanceToStop,
      maxDrawdownLimit: maxDrawdown,
      drawdownType,
      status,
      lastTickAt: latestTick?.timestamp || null,
      accountStatus: account.status,
    });
  }

  return results;
}
