export interface BrokerRuleCheck {
  rule: string;
  field: string;
  passed: boolean;
  value: any;
  threshold?: any;
  reason?: string;
}

export interface BrokerValidationResult {
  eligible: boolean;
  checks: BrokerRuleCheck[];
  skippedReason?: string;
  resolvedTier?: TopstepXTierParams | null;
}

export interface TopstepXTierParams {
  accountSize: number;
  profitTarget: number;
  dailyLossLimit: number;
  maxLossLimit: number;
  maxContracts: number;
  consistencyRule: number;
  minTradingDays: number;
}

const TOPSTEPX_TIERS: TopstepXTierParams[] = [
  { accountSize: 50000,  profitTarget: 3000, dailyLossLimit: 1000, maxLossLimit: 2000, maxContracts: 5,  consistencyRule: 40, minTradingDays: 5 },
  { accountSize: 100000, profitTarget: 6000, dailyLossLimit: 2000, maxLossLimit: 3000, maxContracts: 10, consistencyRule: 40, minTradingDays: 5 },
  { accountSize: 150000, profitTarget: 9000, dailyLossLimit: 3000, maxLossLimit: 4500, maxContracts: 15, consistencyRule: 40, minTradingDays: 5 },
];

const TOPSTEPX_PERMITTED_PRODUCTS = ["CME", "CBOT", "NYMEX", "COMEX"];

export function resolveTopstepXTier(raw: {
  profitTarget?: number;
  maxContractsAllowed?: number;
  dailyLossLimit?: number;
  trailingDrawdown?: number;
  balance?: number;
  name?: string;
  accountNumber?: string;
}): TopstepXTierParams | null {
  if (raw.profitTarget && raw.profitTarget > 0) {
    const match = TOPSTEPX_TIERS.find(t => t.profitTarget === raw.profitTarget);
    if (match) return match;
  }
  if (raw.maxContractsAllowed && raw.maxContractsAllowed > 0) {
    const match = TOPSTEPX_TIERS.find(t => t.maxContracts === raw.maxContractsAllowed);
    if (match) return match;
  }
  if (raw.dailyLossLimit && raw.dailyLossLimit > 0) {
    const match = TOPSTEPX_TIERS.find(t => t.dailyLossLimit === raw.dailyLossLimit);
    if (match) return match;
  }
  if (raw.trailingDrawdown && raw.trailingDrawdown > 0) {
    const match = TOPSTEPX_TIERS.find(t => t.maxLossLimit === raw.trailingDrawdown);
    if (match) return match;
  }
  const identifier = raw.name || raw.accountNumber || "";
  if (identifier) {
    const sizeMatch = identifier.match(/(\d+)K/i);
    if (sizeMatch) {
      const sizeK = parseInt(sizeMatch[1]) * 1000;
      const match = TOPSTEPX_TIERS.find(t => t.accountSize === sizeK);
      if (match) return match;
    }
  }
  if (raw.balance && raw.balance > 0) {
    const sorted = [...TOPSTEPX_TIERS].sort((a, b) => a.accountSize - b.accountSize);
    for (const tier of sorted) {
      if (raw.balance <= tier.accountSize * 1.15 && raw.balance >= tier.accountSize * 0.85) {
        return tier;
      }
    }
  }
  return null;
}

const TOPSTEPX_BURNED_STATUSES = [
  "closed", "violated", "expired", "inactive",
  "disabled", "terminated", "failed", "liquidated",
];

export function validateTopstepXAccount(raw: {
  isActive?: boolean;
  status?: string;
  balance?: number;
  trailingDrawdown?: number;
  dailyLossLimit?: number;
  profitTarget?: number;
  maxContractsAllowed?: number;
  accountType?: string;
  topDayProfit?: number;
  totalProfit?: number;
  peakBalance?: number;
}): BrokerValidationResult {
  const checks: BrokerRuleCheck[] = [];
  const tier = resolveTopstepXTier(raw);

  const isActivePassed = raw.isActive !== false;
  checks.push({
    rule: "account_active",
    field: "isActive",
    passed: isActivePassed,
    value: raw.isActive,
    reason: isActivePassed ? undefined : "חשבון סומן כלא פעיל ב-TopstepX",
  });

  const statusNormalized = (raw.status || "").toLowerCase().trim();
  const statusPassed = !TOPSTEPX_BURNED_STATUSES.includes(statusNormalized);
  checks.push({
    rule: "status_valid",
    field: "status",
    passed: statusPassed,
    value: raw.status,
    threshold: TOPSTEPX_BURNED_STATUSES,
    reason: statusPassed ? undefined : `סטטוס חשבון "${raw.status}" מצביע על חריגה/סגירה`,
  });

  const balance = raw.balance || 0;
  const maxLoss = raw.trailingDrawdown || tier?.maxLossLimit || 0;
  const accountSize = tier?.accountSize || 0;
  const eodPeak = raw.peakBalance || accountSize;
  let maxLossPassed = true;
  if (maxLoss > 0 && accountSize > 0) {
    const drawdownFloor = Math.max(accountSize - maxLoss, eodPeak - maxLoss);
    maxLossPassed = balance >= drawdownFloor;
  }
  const effectiveFloor = Math.max(accountSize - maxLoss, eodPeak - maxLoss);
  checks.push({
    rule: "max_loss_limit",
    field: "balance vs maxLossLimit (trailing EOD drawdown)",
    passed: maxLossPassed,
    value: { balance, maxLossLimit: maxLoss, accountSize, eodPeakBalance: eodPeak },
    threshold: tier ? { floor: effectiveFloor } : undefined,
    reason: maxLossPassed ? undefined : `חריגת Maximum Loss Limit: יתרה $${balance.toLocaleString()} מתחת לרצפת דראודאון $${effectiveFloor.toLocaleString()} (trailing EOD: $${maxLoss.toLocaleString()}, peak: $${eodPeak.toLocaleString()})`,
  });

  const dailyLimit = raw.dailyLossLimit || tier?.dailyLossLimit || 0;
  checks.push({
    rule: "daily_loss_limit",
    field: "dailyLossLimit",
    passed: true,
    value: dailyLimit,
    threshold: tier?.dailyLossLimit,
  });

  const totalProfit = raw.totalProfit || 0;
  const topDay = raw.topDayProfit || 0;
  const consistencyThreshold = tier?.consistencyRule || 40;
  let consistencyPassed = true;
  let consistencyPercent = 0;
  if (totalProfit > 0 && topDay > 0) {
    consistencyPercent = (topDay / totalProfit) * 100;
    consistencyPassed = consistencyPercent <= consistencyThreshold;
  }
  checks.push({
    rule: "consistency_40pct",
    field: "topDayProfit / totalProfit",
    passed: consistencyPassed,
    value: { topDayProfit: topDay, totalProfit, consistencyPercent: Math.round(consistencyPercent * 100) / 100 },
    threshold: consistencyThreshold,
    reason: consistencyPassed ? undefined : `חריגת חוק עקביות 40%: יום בודד ($${topDay.toLocaleString()}) = ${consistencyPercent.toFixed(1)}% מסך הרווח ($${totalProfit.toLocaleString()})`,
  });

  const profitTarget = raw.profitTarget || tier?.profitTarget || 0;
  checks.push({
    rule: "profit_target",
    field: "profitTarget",
    passed: true,
    value: profitTarget,
    threshold: tier?.profitTarget,
  });

  const maxContracts = raw.maxContractsAllowed || tier?.maxContracts || 0;
  checks.push({
    rule: "max_position_size",
    field: "maxContractsAllowed",
    passed: true,
    value: maxContracts,
    threshold: tier?.maxContracts,
  });

  checks.push({
    rule: "no_overnight_positions",
    field: "policy",
    passed: true,
    value: "סגירת כל הפוזיציות עד 15:10 CT",
  });

  checks.push({
    rule: "permitted_products",
    field: "exchanges",
    passed: true,
    value: TOPSTEPX_PERMITTED_PRODUCTS,
  });

  checks.push({
    rule: "min_trading_days",
    field: "minTradingDays",
    passed: true,
    value: tier?.minTradingDays || 5,
  });

  checks.push({
    rule: "professional_conduct",
    field: "policy",
    passed: true,
    value: "איסור Arb, HFT, Latency exploitation",
  });

  const eligible = checks.every(c => c.passed);
  const failedCheck = checks.find(c => !c.passed);

  return {
    eligible,
    checks,
    skippedReason: failedCheck?.reason,
    resolvedTier: tier,
  };
}

const TRADOVATE_BURNED_STATUSES = [
  "closed", "disabled", "inactive", "liquidated",
  "terminated", "expired", "suspended",
];

export function validateTradovateAccount(raw: {
  active?: boolean;
  legalStatus?: string;
  accountType?: string;
  marginAccountType?: string;
  cashBalance?: { amount?: number };
  topDayProfit?: number;
  totalProfit?: number;
  consistencyRule?: number;
}): BrokerValidationResult {
  const checks: BrokerRuleCheck[] = [];

  const isActivePassed = raw.active !== false;
  checks.push({
    rule: "account_active",
    field: "active",
    passed: isActivePassed,
    value: raw.active,
    reason: isActivePassed ? undefined : "חשבון סומן כלא פעיל ב-Tradovate",
  });

  const legalNormalized = (raw.legalStatus || "").toLowerCase().trim();
  const legalPassed = !TRADOVATE_BURNED_STATUSES.includes(legalNormalized);
  checks.push({
    rule: "legal_status_valid",
    field: "legalStatus",
    passed: legalPassed,
    value: raw.legalStatus,
    threshold: TRADOVATE_BURNED_STATUSES,
    reason: legalPassed ? undefined : `סטטוס משפטי "${raw.legalStatus}" מצביע על חשבון סגור/מושעה`,
  });

  const balance = raw.cashBalance?.amount ?? 0;
  checks.push({
    rule: "has_balance",
    field: "cashBalance.amount",
    passed: true,
    value: balance,
  });

  const consistencyThreshold = raw.consistencyRule || 40;
  const totalProfit = raw.totalProfit || 0;
  const topDay = raw.topDayProfit || 0;
  let consistencyPassed = true;
  let consistencyPercent = 0;
  if (totalProfit > 0 && topDay > 0) {
    consistencyPercent = (topDay / totalProfit) * 100;
    consistencyPassed = consistencyPercent <= consistencyThreshold;
  }
  checks.push({
    rule: "consistency_40pct",
    field: "topDayProfit / totalProfit",
    passed: consistencyPassed,
    value: { topDayProfit: topDay, totalProfit, consistencyPercent: Math.round(consistencyPercent * 100) / 100 },
    threshold: consistencyThreshold,
    reason: consistencyPassed ? undefined : `חריגת חוק עקביות ${consistencyThreshold}%: יום בודד ($${topDay.toLocaleString()}) = ${consistencyPercent.toFixed(1)}% מסך הרווח ($${totalProfit.toLocaleString()})`,
  });

  checks.push({
    rule: "account_type",
    field: "accountType",
    passed: true,
    value: raw.accountType,
  });

  checks.push({
    rule: "margin_type",
    field: "marginAccountType",
    passed: true,
    value: raw.marginAccountType,
  });

  const eligible = checks.every(c => c.passed);
  const failedCheck = checks.find(c => !c.passed);

  return {
    eligible,
    checks,
    skippedReason: failedCheck?.reason,
  };
}

export function validateBrokerAccount(
  providerKey: string,
  rawAccount: any,
): BrokerValidationResult {
  switch (providerKey) {
    case "topstepx":
      return validateTopstepXAccount(rawAccount);
    case "tradovate":
      return validateTradovateAccount(rawAccount);
    default:
      return { eligible: true, checks: [] };
  }
}
