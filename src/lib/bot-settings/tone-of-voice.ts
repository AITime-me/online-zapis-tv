/**
 * Tone of Voice — hard product rules for future Bot Core post-filter.
 * Readiness AUTO stays red until post-filter exists with tests.
 */

export const BOT_TONE_OF_VOICE = {
  style: ["тёплый", "мягкий", "женственный", "экспертный"] as const,
  addressForm: "Вы" as const,
  addressFormCapitalized: true,
  rules: [
    "Короткие сообщения",
    "Один вопрос за раз",
    "Без повторных приветствий",
    "Лёгкий юмор только о ситуации",
    "Никогда не шутить над клиентом",
    "Без давления",
    "Без фамильярности",
    "Без оценки внешности",
  ] as const,
  bannedPhrases: ["освежить лицо"] as const,
  medicalForbidden: [
    "Не обещать гарантированный результат",
    "Не ставить диагнозы",
    "Не назначать препараты",
    "Не давать медицинских рекомендаций",
  ] as const,
  postFilterRequiredForAuto: true,
  postFilterImplemented: false,
} as const;

export const BOT_PII_BOUNDARIES = [
  "Бот не просит телефон и имя в свободной AI-переписке",
  "Телефон и имя — только через защищённую форму Booking Service",
  "Согласие на ПДн и оферта остаются в форме",
  "AI Bot Core не получает полную карточку клиента",
  "Channel user ID и текст диалога — потенциальные ПДн: хранить минимально",
  "Не передавать лишнее LLM",
  "Не объединять анонимные профили между каналами без законного основания",
  "Логи очищать от сырой ПДн",
  "Удаление данных — только через подтверждённый административный процесс",
] as const;
