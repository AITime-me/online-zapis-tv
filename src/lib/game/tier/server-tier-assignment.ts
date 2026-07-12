import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  MAX_TIER_WEIGHT_SUM,
  MAX_TIER_VALUE,
} from "@/lib/game/tier/game-catalog-settings-contract";
import {
  parseGameCatalogSettings,
  resolveCampaignKey,
  resolveRulesVersion,
} from "@/lib/game/tier/game-catalog-settings";
import type { CatchTimeServerAssignmentV1 } from "@/lib/game/tier/server-assignment-contract";
import {
  applyPremiumTierGuard,
  buildTierBucket,
  PREMIUM_TIERS_ENABLED,
} from "@/lib/game/tier/server-tier-policy";

export type TierWeightEntry = {
  tier: number;
  weight: number;
};

export type TierAssignmentPolicy = {
  premiumTiersEnabled: boolean;
};

export type BuildServerAssignmentInput = {
  mechanicType: "CATCH_TIME";
  catalogCampaignKey: string | null;
  catalogRulesVersion: string;
  settingsRaw: unknown;
  now: Date;
  randomInt?: (maxExclusive: number) => number;
};

const DEFAULT_TIER_ZERO_WEIGHT: TierWeightEntry = { tier: 0, weight: 1 };

function isValidTierWeightEntry(entry: TierWeightEntry): boolean {
  return (
    Number.isInteger(entry.tier) &&
    entry.tier >= 0 &&
    entry.tier <= MAX_TIER_VALUE &&
    Number.isInteger(entry.weight) &&
    entry.weight > 0 &&
    Number.isFinite(entry.weight)
  );
}

export function normalizeTierWeights(
  weights: TierWeightEntry[],
  policy: TierAssignmentPolicy = { premiumTiersEnabled: PREMIUM_TIERS_ENABLED },
): TierWeightEntry[] {
  const normalized = weights.filter(isValidTierWeightEntry);

  if (!policy.premiumTiersEnabled) {
    const tierZero = normalized.filter((entry) => entry.tier === 0);
    return tierZero.length > 0 ? tierZero : [DEFAULT_TIER_ZERO_WEIGHT];
  }

  if (normalized.length === 0) {
    return [DEFAULT_TIER_ZERO_WEIGHT];
  }

  const hasTierZero = normalized.some((entry) => entry.tier === 0);
  return hasTierZero ? normalized : [DEFAULT_TIER_ZERO_WEIGHT, ...normalized];
}

export function assignServerTier(
  weights: TierWeightEntry[],
  randomIntFn: (maxExclusive: number) => number,
  policy: TierAssignmentPolicy = { premiumTiersEnabled: PREMIUM_TIERS_ENABLED },
): number {
  const normalized = normalizeTierWeights(weights, policy);

  if (!policy.premiumTiersEnabled) {
    return 0;
  }

  let totalWeight = 0;
  for (const entry of normalized) {
    const next = totalWeight + entry.weight;
    if (!Number.isSafeInteger(next) || next > MAX_TIER_WEIGHT_SUM) {
      return 0;
    }
    totalWeight = next;
  }

  if (totalWeight <= 0) {
    return 0;
  }

  const roll = randomIntFn(totalWeight);
  let cursor = 0;
  for (const entry of normalized) {
    cursor += entry.weight;
    if (roll < cursor) {
      return applyPremiumTierGuard(entry.tier);
    }
  }

  return 0;
}

export function productionRandomInt(maxExclusive: number): number {
  return cryptoRandomInt(maxExclusive);
}

export function buildServerAssignment(
  input: BuildServerAssignmentInput,
): CatchTimeServerAssignmentV1 {
  const parsed = parseGameCatalogSettings(input.settingsRaw);
  const settings = parsed.settings;
  const campaignKey = resolveCampaignKey(input.catalogCampaignKey, settings);
  const rulesVersion = resolveRulesVersion(input.catalogRulesVersion, settings);
  const tierWeights = settings?.tierWeights ?? [];
  const randomIntFn = input.randomInt ?? productionRandomInt;
  const assignedTier = applyPremiumTierGuard(
    assignServerTier(tierWeights, randomIntFn, {
      premiumTiersEnabled: PREMIUM_TIERS_ENABLED,
    }),
  );

  return {
    version: 1,
    mechanicType: input.mechanicType,
    serverResultTier: assignedTier,
    campaignKey,
    rulesVersion,
    assignedAt: input.now.toISOString(),
    tierBucket: buildTierBucket(assignedTier),
  };
}

export function resolveTierWeightsFromSettingsRaw(raw: unknown): TierWeightEntry[] {
  const parsed = parseGameCatalogSettings(raw);
  return parsed.settings?.tierWeights ?? [];
}
