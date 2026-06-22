export interface EquityDataPoint {
  timestamp: string;
  equity: number;
}

export interface AccountInput {
  accountId: string;
  startingBalance: number;
  maxDrawdownLimit: number;
  equityData: EquityDataPoint[];
}

export interface BreachDetail {
  timestamp: string;
  hwmAtBreach: number;
  equityAtBreach: number;
  trailingStopAtBreach: number;
}

export interface EvaluatedAccount {
  accountId: string;
  startingBalance: number;
  maxDrawdownLimit: number;
  finalEquity: number;
  highWaterMark: number;
  trailingStop: number;
  breached: boolean;
  breach?: BreachDetail;
}

export interface EvaluationResult {
  active: EvaluatedAccount[];
  disqualified: EvaluatedAccount[];
  totalAccounts: number;
  evaluatedAt: string;
}

export function evaluateTrailingDrawdown(account: AccountInput): EvaluatedAccount {
  const { accountId, startingBalance, maxDrawdownLimit, equityData } = account;

  let hwm = startingBalance;
  let trailingStop = startingBalance - maxDrawdownLimit;

  for (const point of equityData) {
    if (point.equity > hwm) {
      hwm = point.equity;
      const rawStop = hwm - maxDrawdownLimit;
      trailingStop = Math.min(rawStop, startingBalance);
    }

    if (point.equity <= trailingStop) {
      return {
        accountId,
        startingBalance,
        maxDrawdownLimit,
        finalEquity: point.equity,
        highWaterMark: hwm,
        trailingStop,
        breached: true,
        breach: {
          timestamp: point.timestamp,
          hwmAtBreach: hwm,
          equityAtBreach: point.equity,
          trailingStopAtBreach: trailingStop,
        },
      };
    }
  }

  const finalEquity = equityData.length > 0 ? equityData[equityData.length - 1].equity : startingBalance;

  return {
    accountId,
    startingBalance,
    maxDrawdownLimit,
    finalEquity,
    highWaterMark: hwm,
    trailingStop,
    breached: false,
  };
}

export function evaluateAccountsBatch(accounts: AccountInput[]): EvaluationResult {
  const active: EvaluatedAccount[] = [];
  const disqualified: EvaluatedAccount[] = [];

  for (const account of accounts) {
    const result = evaluateTrailingDrawdown(account);
    if (result.breached) {
      disqualified.push(result);
    } else {
      active.push(result);
    }
  }

  return {
    active,
    disqualified,
    totalAccounts: accounts.length,
    evaluatedAt: new Date().toISOString(),
  };
}

export interface TrailingDrawdownState {
  hwm: number;
  trailingStop: number;
  rawStop: number;
  distanceToStop: number;
  drawdownRisk: number;
  lowestEquity: number;
  breachedByLow: boolean;
  /**
   * True once the trailing stop has reached its lock at startingBalance.
   * Apex/Topstep rule: trailing stop moves up with the high-water mark but
   * never exceeds the starting account size. Once `peakBalance - limit >=
   * startingBalance`, the floor freezes at startingBalance forever.
   */
  locked: boolean;
}

export function computeTrailingDrawdownState(
  startingBalance: number,
  maxDrawdownLimit: number,
  currentEquity: number,
  peakBalance: number,
  lowestEquity?: number | null
): TrailingDrawdownState {
  const hwm = Math.max(peakBalance, startingBalance, currentEquity);
  const rawStop = hwm - maxDrawdownLimit;
  const trailingStop = Math.min(rawStop, startingBalance);
  const locked = rawStop >= startingBalance;
  const effectiveLowest = lowestEquity != null ? Math.min(lowestEquity, currentEquity) : currentEquity;
  const worstDistance = effectiveLowest - trailingStop;
  const currentDistance = currentEquity - trailingStop;
  const distanceToStop = Math.min(worstDistance, currentDistance);
  const drawdownRisk = maxDrawdownLimit > 0 ? Math.max(0, (1 - distanceToStop / maxDrawdownLimit) * 100) : 0;
  const breachedByLow = effectiveLowest <= trailingStop;

  return { hwm, trailingStop, rawStop, distanceToStop, drawdownRisk, lowestEquity: effectiveLowest, breachedByLow, locked };
}
