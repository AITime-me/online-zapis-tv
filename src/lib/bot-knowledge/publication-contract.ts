export const BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION = 1 as const;

export const BOT_KNOWLEDGE_WORKSPACE_ID = "default" as const;

export const BOT_KNOWLEDGE_CATEGORIES = [
  "PROCEDURE_EXPLANATION",
  "FAQ",
  "PREPARATION",
  "AFTERCARE",
  "OBJECTION_HANDLING",
  "SAFETY_INFORMATION",
  "POLICY_EXPLANATION",
  "ESCALATION_GUIDANCE",
] as const;

export type BotKnowledgeCategoryId = (typeof BOT_KNOWLEDGE_CATEGORIES)[number];

/** Deterministic publish order: category rank then stableKey. */
export const BOT_KNOWLEDGE_CATEGORY_ORDER: readonly BotKnowledgeCategoryId[] =
  BOT_KNOWLEDGE_CATEGORIES;

export const BOT_KNOWLEDGE_CATEGORY_LABELS: Record<BotKnowledgeCategoryId, string> = {
  PROCEDURE_EXPLANATION: "Объяснение процедуры",
  FAQ: "FAQ",
  PREPARATION: "Подготовка",
  AFTERCARE: "Уход после",
  OBJECTION_HANDLING: "Работа с возражениями",
  SAFETY_INFORMATION: "Безопасность",
  POLICY_EXPLANATION: "Политики студии",
  ESCALATION_GUIDANCE: "Эскалация / handoff",
};

export type BotKnowledgePublishedEntryV1 = {
  key: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tags: string[];
  serviceId: string | null;
};

export type BotKnowledgePublicationPayloadV1 = {
  schemaVersion: typeof BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION;
  entries: BotKnowledgePublishedEntryV1[];
};

/**
 * Structured live facts are forbidden in the KB contract.
 * Runtime LIVE SoT is `GET /api/internal/bot/v1/live-facts` (BOT-CONTROL-PLANE-05)
 * and must win over any KB prose for price/duration/masters/bookingMode/active
 * state/structured studio fields. Availability stays on request-time booking APIs.
 * Semantic AI validation is intentionally out of scope; only schema + light
 * exact-price copy guards exist at publish time.
 */
export const BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS = [
  "price",
  "priceFrom",
  "priceTo",
  "duration",
  "durationMinutes",
  "master",
  "masters",
  "schedule",
  "slots",
  "availability",
  "bookingMode",
  "appointmentState",
  "promotions",
  "discounts",
  "gifts",
  "studioHours",
  "workingHoursText",
  "address",
] as const;

export const BOT_KNOWLEDGE_NOT_PUBLISHED_CODE = "BOT_KNOWLEDGE_NOT_PUBLISHED" as const;
export const BOT_KNOWLEDGE_PUBLICATION_INVALID_CODE =
  "BOT_KNOWLEDGE_PUBLICATION_INVALID" as const;
