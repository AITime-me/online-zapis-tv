import { z } from "zod";
import {
  GAME_CATALOG_SETTINGS_VERSION,
  MAX_CAMPAIGN_STRING_LENGTH,
  MAX_RULES_VERSION_LENGTH,
  MAX_TIER_VALUE,
  MAX_TIER_WEIGHT_ENTRIES,
  MAX_TIER_WEIGHT_SUM,
  type GameCatalogSettingsStatus,
  type GameCatalogSettingsV1,
} from "@/lib/game/tier/game-catalog-settings-contract";

export type ParsedGameCatalogSettings = {
  status: GameCatalogSettingsStatus;
  settings: GameCatalogSettingsV1 | null;
};

const finiteNonNegativeInt = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const tierWeightEntrySchema = z.object({
  tier: finiteNonNegativeInt.max(MAX_TIER_VALUE),
  weight: finiteNonNegativeInt,
});

const campaignSchema = z.object({
  key: z.string().trim().min(1).max(MAX_CAMPAIGN_STRING_LENGTH).optional(),
  rulesVersion: z
    .string()
    .trim()
    .min(1)
    .max(MAX_RULES_VERSION_LENGTH)
    .optional(),
});

const gameCatalogSettingsSchema = z
  .object({
    version: z.literal(GAME_CATALOG_SETTINGS_VERSION),
    campaign: campaignSchema.optional(),
    tierWeights: z.array(tierWeightEntrySchema).max(MAX_TIER_WEIGHT_ENTRIES).optional(),
    directionPolicy: z.literal("cosmetic").optional(),
    wheel: z.unknown().optional(),
  })
  .passthrough();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sumTierWeights(weights: Array<{ tier: number; weight: number }>): number {
  let sum = 0;
  for (const entry of weights) {
    if (entry.weight <= 0) {
      continue;
    }
    const next = sum + entry.weight;
    if (!Number.isSafeInteger(next)) {
      return 0;
    }
    sum = next;
  }
  return sum;
}

export function parseGameCatalogSettings(raw: unknown): ParsedGameCatalogSettings {
  if (raw === null || raw === undefined) {
    return { status: "safe-default", settings: null };
  }

  if (!isPlainObject(raw)) {
    return { status: "invalid", settings: null };
  }

  const parsed = gameCatalogSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "invalid", settings: null };
  }

  const tierWeights = parsed.data.tierWeights ?? [];
  const positiveWeights = tierWeights.filter((entry) => entry.weight > 0);
  if (tierWeights.length > 0 && positiveWeights.length === 0) {
    return { status: "invalid", settings: null };
  }

  if (positiveWeights.length > 0 && sumTierWeights(positiveWeights) <= 0) {
    return { status: "invalid", settings: null };
  }

  return {
    status: "valid",
    settings: {
      version: GAME_CATALOG_SETTINGS_VERSION,
      campaign: parsed.data.campaign,
      tierWeights: positiveWeights.length > 0 ? positiveWeights : undefined,
      directionPolicy: parsed.data.directionPolicy,
      wheel: parsed.data.wheel,
    },
  };
}

export function resolveCampaignKey(
  catalogCampaignKey: string | null,
  settings: GameCatalogSettingsV1 | null,
): string | null {
  const settingsKey = settings?.campaign?.key?.trim();
  if (settingsKey) {
    return settingsKey;
  }
  const catalogKey = catalogCampaignKey?.trim();
  return catalogKey || null;
}

export function resolveRulesVersion(
  catalogRulesVersion: string,
  settings: GameCatalogSettingsV1 | null,
): string {
  const base = catalogRulesVersion.trim() || "1";
  const settingsVersion = settings?.campaign?.rulesVersion?.trim();
  if (settingsVersion && settingsVersion === base) {
    return settingsVersion;
  }
  return base;
}

export function deriveSettingsStatus(raw: unknown): GameCatalogSettingsStatus {
  return parseGameCatalogSettings(raw).status;
}
