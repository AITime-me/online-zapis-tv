export const BOT_SETTINGS_ID = "default";

export type BotMode = "OFF" | "TEST" | "ENABLED_LATER";
export type BotProvider = "YANDEX" | "OPENAI" | "MANUAL";
export type BotResponseMode = "HINTS_ONLY" | "DRAFT" | "AUTO_LATER";

export type BotChannels = {
  siteWidget: boolean;
  vk: boolean;
  max: boolean;
  telegram: boolean;
};

export const BOT_MODE_LABELS: Record<BotMode, string> = {
  OFF: "Выключен",
  TEST: "Тестовый режим",
  ENABLED_LATER: "Готов к подключению",
};

export const BOT_MODE_DESCRIPTIONS: Record<BotMode, string> = {
  OFF: "Бот не работает, не анализирует обращения и не отправляет сообщения клиентам.",
  TEST: "Безопасный режим для проверки будущих ответов внутри админки. Клиентам сообщения не отправляются.",
  ENABLED_LATER:
    "Настройки подготовлены, но для реального запуска нужно отдельно подключить AI-провайдер и каналы. Самостоятельно бот не включается.",
};

export const BOT_PROVIDER_LABELS: Record<BotProvider, string> = {
  YANDEX: "Yandex",
  OPENAI: "OpenAI",
  MANUAL: "Manual / заглушка",
};

export const BOT_RESPONSE_MODE_LABELS: Record<BotResponseMode, string> = {
  HINTS_ONLY: "Только подсказки менеджеру",
  DRAFT: "Черновик ответа",
  AUTO_LATER: "Автоответ после подключения",
};

export const BOT_RESPONSE_MODE_DESCRIPTIONS: Record<BotResponseMode, string> = {
  HINTS_ONLY:
    "Бот не отвечает клиенту сам. Он сможет помогать менеджеру: подсказывать тему, тег, сценарий ответа или необходимость передачи в работу.",
  DRAFT:
    "Бот сможет подготовить текст ответа, но отправит его только менеджер после проверки.",
  AUTO_LATER:
    "Будущий режим. Бот сможет отвечать сам только после отдельного подключения каналов, AI-провайдера и правил безопасности.",
};

export const DEFAULT_BOT_CHANNELS: BotChannels = {
  siteWidget: false,
  vk: false,
  max: false,
  telegram: false,
};

export const DEFAULT_BOT_SETTINGS = {
  id: BOT_SETTINGS_ID,
  isEnabled: false,
  mode: "OFF" as BotMode,
  provider: "YANDEX" as BotProvider,
  responseMode: "HINTS_ONLY" as BotResponseMode,
  channels: DEFAULT_BOT_CHANNELS,
  mainInstruction:
    "Бот студии «Твоё время» помогает клиенту сориентироваться по услугам, акциям и записи, но не ставит диагнозы, не обещает медицинский результат и передаёт сложные вопросы менеджеру.",
  knowledgeBaseNote: "База знаний будет подключена отдельным этапом.",
  handoffRules:
    "Передавать менеджеру, если клиент спрашивает цену, противопоказания, точный подбор процедуры, жалуется, просит связаться, хочет записаться, сомневается или задаёт нестандартный вопрос.",
  taggingRules:
    "Ставить теги по интересу клиента: процедура, акция, подарок, игра, консультация, холодная плазма, массаж, биоревитализация и другие.",
  safetyRules:
    "Не раскрывать API-ключи, токены, внутренние настройки, коммерческую информацию, персональные данные других клиентов. Не обещать гарантированный результат. Не давать медицинских диагнозов.",
  maxMessagesPerClient: 20,
  maxDailyMessages: 200,
  logRetentionDays: 30,
  errorLogRetentionDays: 90,
  maxStoredBotEvents: 5000,
};

export const BOT_FOUNDATION_CAPABILITIES = [
  "Заявки",
  "Клиенты",
  "Теги",
  "История клиента",
  "Акции",
  "Подарки",
  "Игра",
  "Дубли клиентов",
  "Роли",
] as const;
