/**
 * Future Campaign Engine — not implemented in runtime.
 * Promo discount calculation stays in promo-engine only.
 */

export const BOT_CAMPAIGN_ENGINE_FIELDS = [
  "title",
  "status",
  "period",
  "codeWord",
  "relatedServices",
  "gift",
  "responseScenario",
  "cta",
  "source",
  "segment",
  "priority",
] as const;

export const BOT_CAMPAIGN_ENGINE_GAPS = [
  {
    id: "bot_code_words",
    label: "Bot code words",
    status: "not_implemented" as const,
  },
  {
    id: "bot_campaign_scenarios",
    label: "Bot campaign scenarios",
    status: "not_implemented" as const,
  },
  {
    id: "segments",
    label: "Сегменты",
    status: "not_implemented" as const,
  },
  {
    id: "broadcasts",
    label: "Рассылки",
    status: "not_implemented" as const,
  },
] as const;

export const BOT_DISCOUNT_CALCULATION_POLICY = {
  engine: "promo-engine",
  ruleIdExample: "cold-plasma-first-visit-30",
  dbPromotionRole: "homepage_carousel_card_only",
  botMayExplain: true,
  secondDiscountEngineForbidden: true,
  firstVisitPhoneLogicUnchanged: true,
} as const;

/**
 * GAME FLOW uses live game platform + session snapshot — not static KB examples.
 */
export const BOT_GAME_FLOW_POLICY = {
  kind: "permanent_inbound_scenario",
  notOrdinaryPromotion: true,
  giftSource: "GamePlay/GameSession snapshot only",
  requiredContext: [
    "game id",
    "campaign key",
    "rules version",
    "GamePlay/GameSession",
    "direction snapshot",
    "gift snapshot",
    "rules snapshot",
    "redeem deadline",
    "consume status",
  ] as const,
  botMust: [
    "Подтвердить фактический результат",
    "Назвать фактическое направление",
    "Назвать фактический подарок",
    "Задать один уточняющий вопрос",
    "Вести к записи",
  ] as const,
  botMustNot: [
    "Повторно выбирать подарок",
    "Расширять gift pool",
    "Включать premium",
    "Считать подарок по старым текстам KB/DOCX",
    "Менять результат после смены активной игры",
  ] as const,
  outdatedExampleNote:
    "Старый пример GAME FLOW с подарком «Уход для рук» устарел и не является источником истины.",
  formulaSiyaniyaPolicy:
    "«Формула сияния» остаётся tier 2 и не выдаётся, пока premium policy выключена.",
} as const;

export const BOT_SLOT_STRATEGY_GAPS = [
  {
    id: "ranked_slots_api",
    label: "Ранжированные 2–3 окна",
    status: "not_implemented" as const,
  },
  {
    id: "temporary_hold_api",
    label: "Временная бронь (TTL)",
    status: "not_implemented" as const,
  },
  {
    id: "final_slot_recheck",
    label: "Повторная проверка слота перед записью",
    status: "requires_booking_workflow" as const,
  },
] as const;

export const BOT_RESCHEDULE_OWNERSHIP_GAP = {
  id: "reschedule_ownership",
  status: "not_implemented" as const,
  owners: ["MANAGER", "BOT", "UNASSIGNED"] as const,
  note:
    "Автоперенос ботом не реализуется сейчас. Существующий reschedule flow не меняется. Ownership/runtime отсутствует — readiness gap.",
} as const;

export const BOT_ADDRESS_FIELD_GAPS = [
  { field: "address", inStudioSettings: true },
  { field: "mapUrl", inStudioSettings: false },
  { field: "landmark", inStudioSettings: false },
  { field: "floor", inStudioSettings: false },
  { field: "cabinet", inStudioSettings: false },
  { field: "entrance", inStudioSettings: false },
  { field: "intercomCode", inStudioSettings: false },
  { field: "relocatedNotice", inStudioSettings: false },
] as const;
