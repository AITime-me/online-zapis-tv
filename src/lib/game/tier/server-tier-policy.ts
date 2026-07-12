/** Premium rewards remain disabled until redemption conditions are approved and implemented. */
export const PREMIUM_TIERS_ENABLED = false as const;

export const C2_SERVER_TIER_POLICY = "tier-0-only" as const;

export const PREMIUM_DISABLED_READINESS_WARNING =
  "Premium rewards disabled pending redemption rules.";

export function applyPremiumTierGuard(tier: number): number {
  if (!PREMIUM_TIERS_ENABLED) {
    return 0;
  }
  if (!Number.isInteger(tier) || tier < 0) {
    return 0;
  }
  return tier;
}

export function buildTierBucket(tier: number): string {
  return `tier-${applyPremiumTierGuard(tier)}`;
}
