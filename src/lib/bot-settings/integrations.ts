/**
 * Messaging channels vs CRM. Canonical phase order is in architecture.ts.
 * WhatsApp — future enum/adapter only, no runtime.
 */

export type BotMessagingChannelId =
  | "site"
  | "vk"
  | "max"
  | "telegram"
  | "whatsapp";

export type BotCrmIntegrationId = "amocrm";

export type BotIntegrationStatus =
  | "not_connected"
  | "planned"
  | "deferred"
  | "ready";

export type BotMessagingChannelInfo = {
  id: BotMessagingChannelId;
  label: string;
  /** JSON key in BotSettings.channels; null for adapters not stored as plan checkbox. */
  settingsKey: "siteWidget" | "vk" | "max" | "telegram" | "whatsapp" | null;
  status: BotIntegrationStatus;
  role: "messaging_channel";
  phase: number;
  detail: string;
  runtime: false;
};

export type BotCrmReadinessItem = {
  id: string;
  label: string;
  ready: false;
  detail: string;
};

export type BotCrmIntegrationInfo = {
  id: BotCrmIntegrationId;
  label: string;
  status: BotIntegrationStatus;
  role: "crm_integration";
  phase: 1;
  detail: string;
  botMay: string[];
  botMustNot: string[];
  readinessItems: BotCrmReadinessItem[];
};

export const BOT_MESSAGING_CHANNELS: BotMessagingChannelInfo[] = [
  {
    id: "vk",
    label: "VK",
    settingsKey: "vk",
    status: "planned",
    role: "messaging_channel",
    phase: 2,
    detail: "Этап 2 · первый реальный клиентский канал после amoCRM. Не подключён.",
    runtime: false,
  },
  {
    id: "max",
    label: "MAX",
    settingsKey: "max",
    status: "planned",
    role: "messaging_channel",
    phase: 3,
    detail:
      "Этап 3 · после VK. Не хардкодить устаревший platform-api.max.ru; сверять актуальную docs (platform-api2.max.ru). Не подключён.",
    runtime: false,
  },
  {
    id: "site",
    label: "Сайт",
    settingsKey: "siteWidget",
    status: "planned",
    role: "messaging_channel",
    phase: 4,
    detail: "Этап 4 · чат-виджет после MAX. Не подключён.",
    runtime: false,
  },
  {
    id: "telegram",
    label: "Telegram",
    settingsKey: "telegram",
    status: "planned",
    role: "messaging_channel",
    phase: 5,
    detail: "Этап 5 · поздний канал. Не подключён.",
    runtime: false,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    settingsKey: "whatsapp",
    status: "deferred",
    role: "messaging_channel",
    phase: 6,
    detail:
      "Этап 6 · отложенный future adapter/enum. Без runtime и без API на foundation.",
    runtime: false,
  },
];

export const BOT_CRM_INTEGRATIONS: BotCrmIntegrationInfo[] = [
  {
    id: "amocrm",
    label: "amoCRM",
    status: "not_connected",
    role: "crm_integration",
    phase: 1,
    detail:
      "Этап 1 · первая внешняя интеграция (до живых каналов). Не мессенджер. OAuth/токены не в BotSettings и не в браузере.",
    botMay: [
      "Создавать задачи менеджеру",
      "Ставить тег «бот»",
      "Ставить тег направления/процедуры",
      "Фиксировать канал и сценарий",
      "Передавать диалог менеджеру",
    ],
    botMustNot: [
      "Автоматически закрывать сделки",
      "Переводить лида в покупателя",
      "Создавать дубли контактов",
      "Самовольно удалять карточки",
      "Менять ручные решения менеджера",
    ],
    readinessItems: [
      {
        id: "connection_status",
        label: "Статус подключения",
        ready: false,
        detail: "Не подключён",
      },
      {
        id: "oauth_readiness",
        label: "OAuth readiness",
        ready: false,
        detail: "OAuth flow не настроен",
      },
      {
        id: "token_health",
        label: "Token health",
        ready: false,
        detail: "Токены не хранятся в UI; health не проверялся",
      },
      {
        id: "webhook_health",
        label: "Webhook health",
        ready: false,
        detail: "Webhook не подключён",
      },
      {
        id: "tasks",
        label: "Задачи",
        ready: false,
        detail: "Создание задач не реализовано",
      },
      {
        id: "tags",
        label: "Теги",
        ready: false,
        detail: "Простановка тегов не реализована",
      },
      {
        id: "lead_source",
        label: "Источник обращения",
        ready: false,
        detail: "Фиксация канала/источника не реализована",
      },
      {
        id: "handoff",
        label: "Handoff менеджеру",
        ready: false,
        detail: "Runtime handoff ownership отсутствует",
      },
      {
        id: "dialog_request_link",
        label: "Связь диалога с заявкой",
        ready: false,
        detail: "Связь диалог↔заявка не реализована",
      },
      {
        id: "last_sync",
        label: "Последняя успешная синхронизация",
        ready: false,
        detail: "Синхронизаций не было",
      },
    ],
  },
];

export const BOT_INTEGRATION_ARCHITECTURE_NOTES = [
  "Каналы общения и amoCRM — разные сущности: мессенджеры доставляют чат, CRM — задачи/теги/handoff.",
  "Канонический порядок: internal API → amoCRM → VK → MAX → сайт → Telegram → WhatsApp.",
  "Не называть сайт, VK и MAX одновременно стартовыми каналами.",
  "Секреты каналов и amoCRM — только server secret store / env, не BotSettings JSON.",
  "Чекбокс канала в админке = намерение плана, не подключение коннектора.",
] as const;
