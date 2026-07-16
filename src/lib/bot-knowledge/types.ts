/**
 * Bot knowledge foundation: source mapping and public-safe fact shapes.
 * Runtime must not invent prices, slots, promotions or gifts.
 */

export const BOT_KNOWLEDGE_SOURCES = [
  "services",
  "service_categories",
  "masters",
  "master_services",
  "availability_service",
  "promo_rules",
  "homepage_promotions",
  "game_catalog",
  "game_config",
  "game_play_snapshot",
  "public_studio_settings",
  "legal_documents",
] as const;

export type BotKnowledgeSourceId = (typeof BOT_KNOWLEDGE_SOURCES)[number];

export type BotKnowledgeSourceStatus =
  | "available"
  | "empty"
  | "not_configured"
  | "requires_bot_core"
  | "requires_api"
  | "gap";

export type BotKnowledgeSourceReport = {
  id: BotKnowledgeSourceId;
  truthSource: string;
  label: string;
  status: BotKnowledgeSourceStatus;
  publicEntityCount: number | null;
  lastCheckedAt: string | null;
  detail: string;
};

export type BotKnowledgeFactRef = {
  source: BotKnowledgeSourceId;
  /** Human-readable origin for prompts/audit — never a secret. */
  label: string;
};

export type BotKnowledgeServiceFact = {
  publicName: string;
  categoryName: string;
  description: string | null;
  durationMinutes: number;
  priceLabel: string;
  source: BotKnowledgeFactRef;
};

export type BotKnowledgeCategoryFact = {
  name: string;
  serviceCount: number;
  source: BotKnowledgeFactRef;
};

export type BotKnowledgeMasterFact = {
  publicName: string;
  description: string | null;
  onlineBookingEnabled: boolean;
  source: BotKnowledgeFactRef;
};

export type BotKnowledgePromoFact = {
  title: string;
  kind: "built_in_discount" | "homepage_card";
  summary: string;
  source: BotKnowledgeFactRef;
};

export type BotKnowledgeGameFact = {
  title: string;
  publicPath: string | null;
  isPubliclyAvailable: boolean;
  activeGiftCount: number;
  giftTitles: string[];
  campaignKey: string | null;
  rulesVersion: string | null;
  source: BotKnowledgeFactRef;
  snapshotNote: string;
};

export type BotKnowledgeAvailabilityPolicy = {
  source: BotKnowledgeFactRef;
  status: "delegated";
  note: string;
  canonicalFunctions: string[];
  temporaryHoldStatus: "gap";
  rankedSlotsStatus: "gap";
};

export type BotKnowledgeAddressPolicy = {
  source: BotKnowledgeFactRef;
  addressPresent: boolean;
  addressPreview: string | null;
  missingFields: string[];
  status: BotKnowledgeSourceStatus;
  note: string;
};

export type BotKnowledgePersonalDataPolicy = {
  note: string;
  allowFullClientDump: false;
  requireIdentifiedDialog: true;
  collectPhoneInChat: false;
};

export type BotKnowledgeFoundationSnapshot = {
  status: "foundation";
  generatedAt: string;
  studio: {
    studioName: string;
    workingHoursText: string;
    isOnlineBookingEnabled: boolean;
    isGameEnabled: boolean;
    isPromotionsEnabled: boolean;
    source: BotKnowledgeFactRef;
  };
  address: BotKnowledgeAddressPolicy;
  categories: BotKnowledgeCategoryFact[];
  services: BotKnowledgeServiceFact[];
  masters: BotKnowledgeMasterFact[];
  promotions: BotKnowledgePromoFact[];
  game: BotKnowledgeGameFact | null;
  availability: BotKnowledgeAvailabilityPolicy;
  personalData: BotKnowledgePersonalDataPolicy;
  sources: BotKnowledgeSourceReport[];
  counts: {
    categories: number;
    services: number;
    masters: number;
    promotions: number;
    gameGifts: number;
  };
};

export type BotKnowledgeFoundationSummary = {
  status: "foundation";
  generatedAt: string;
  counts: BotKnowledgeFoundationSnapshot["counts"];
  availabilityDelegated: true;
  temporaryHoldGap: true;
  addressGap: boolean;
  sources: BotKnowledgeSourceReport[];
  notes: string[];
};
