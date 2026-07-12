export type GameCatalogSettingsV1 = {
  version: 1;
  campaign?: {
    key?: string;
    rulesVersion?: string;
  };
  tierWeights?: Array<{
    tier: number;
    weight: number;
  }>;
  directionPolicy?: "cosmetic";
  wheel?: unknown;
};

export type GameCatalogSettingsStatus = "valid" | "safe-default" | "invalid";

export const GAME_CATALOG_SETTINGS_VERSION = 1 as const;
export const MAX_TIER_WEIGHT_ENTRIES = 16;
export const MAX_TIER_VALUE = 10;
export const MAX_CAMPAIGN_STRING_LENGTH = 64;
export const MAX_RULES_VERSION_LENGTH = 32;
export const MAX_TIER_WEIGHT_SUM = Number.MAX_SAFE_INTEGER;
