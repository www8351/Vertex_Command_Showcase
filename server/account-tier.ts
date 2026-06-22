export const PROP_FIRM_TIERS: readonly number[] = [
  10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 500000,
];

export type AccountType = "LIVE" | "EVAL";

export function determineAccountTier(currentBalance: number): number {
  const balance = Number.isFinite(currentBalance) ? Math.abs(currentBalance) : 0;
  let bestTier = PROP_FIRM_TIERS[0];
  let bestDistance = Math.abs(balance - bestTier);
  for (let i = 1; i < PROP_FIRM_TIERS.length; i++) {
    const tier = PROP_FIRM_TIERS[i];
    const distance = Math.abs(balance - tier);
    if (distance < bestDistance) {
      bestTier = tier;
      bestDistance = distance;
    }
  }
  return bestTier;
}

export function classifyAccountType(
  name: string | null | undefined,
  accountId: string | null | undefined,
): AccountType {
  const haystack = `${name ?? ""} ${accountId ?? ""}`.toUpperCase();
  if (haystack.includes("EXPRESS")) return "LIVE";
  return "EVAL";
}

// Looks for prop-firm tier hints in the account name, e.g. "50K", "100K".
// Returns the matching tier in dollars, or null if no hint is found.
// Prefers the largest match so "150K" wins over a stray "50" substring.
export function extractTierFromName(
  name: string | null | undefined,
  accountId: string | null | undefined,
): number | null {
  const haystack = `${name ?? ""} ${accountId ?? ""}`.toUpperCase();
  const matches = haystack.matchAll(/(\d{1,4})K\b/g);
  let best: number | null = null;
  for (const m of matches) {
    const n = parseInt(m[1], 10) * 1000;
    if (PROP_FIRM_TIERS.includes(n) && (best === null || n > best)) {
      best = n;
    }
  }
  return best;
}

// Resolve the canonical starting balance for an account.
// Prefers an explicit tier embedded in the name, falls back to nearest-tier from balance.
export function resolveStartingBalance(
  name: string | null | undefined,
  accountId: string | null | undefined,
  currentBalance: number,
): number {
  return extractTierFromName(name, accountId) ?? determineAccountTier(currentBalance);
}
