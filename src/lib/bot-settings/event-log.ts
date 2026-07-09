export const BOT_EVENT_LEVELS = ["info", "warning", "error"] as const;

export type BotEventLevel = (typeof BOT_EVENT_LEVELS)[number];

export const BOT_EVENT_LEVEL_LABELS: Record<BotEventLevel, string> = {
  info: "Информация",
  warning: "Предупреждение",
  error: "Ошибка",
};

/** Будущие типы событий бота — справочник, события пока не создаются. */
export const BOT_EVENT_TYPES = [
  "bot_test",
  "draft_created",
  "tag_suggested",
  "handoff_to_manager",
  "provider_error",
  "channel_error",
  "safety_blocked",
  "settings_updated",
] as const;

export type BotEventType = (typeof BOT_EVENT_TYPES)[number];

export const BOT_EVENT_TYPE_LABELS: Record<BotEventType, string> = {
  bot_test: "Тест бота",
  draft_created: "Черновик ответа",
  tag_suggested: "Предложен тег",
  handoff_to_manager: "Передача менеджеру",
  provider_error: "Ошибка провайдера",
  channel_error: "Ошибка канала",
  safety_blocked: "Заблокировано правилами",
  settings_updated: "Обновление настроек",
};

/** В логах нельзя хранить секреты и лишние персональные данные. */
export const BOT_LOG_MUST_NOT_STORE = [
  "API-ключи",
  "Токены",
  "Пароли",
  "Полные системные инструкции с секретами",
  "Персональные данные других клиентов без необходимости",
  "Коммерческие секреты в открытом виде",
] as const;

export const BOT_LOG_CAN_STORE = [
  "Тип события",
  "Уровень",
  "Канал",
  "ID клиента",
  "ID заявки",
  "Краткое безопасное описание",
  "Техническую ошибку без секретов",
] as const;
