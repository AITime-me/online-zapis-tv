/**
 * Control-plane architecture for `/admin/bot`.
 * AI Bot Core is a separate deployable runtime — not inside Next.js.
 */

export const BOT_ECOSYSTEM_PARTS = [
  {
    id: "bot_core",
    label: "AI Bot Core",
    role: "Отдельный runtime: FSM, классификация, диалог, tool calls, каналы",
  },
  {
    id: "booking_service",
    label: "online-zapis-tv (Booking Service)",
    role: "Источник истины: каталог, мастера, availability, запись, ПДн в формах",
  },
  {
    id: "public_site",
    label: "Публичный сайт",
    role: "Витрина и будущий чат-виджет (этап 4)",
  },
  {
    id: "amocrm",
    label: "amoCRM",
    role: "Окно менеджера: задачи, теги, handoff (этап 1, не мессенджер)",
  },
  {
    id: "client_channels",
    label: "Клиентские каналы",
    role: "VK → MAX → сайт → Telegram → WhatsApp; не знают внутренности Booking",
  },
] as const;

export const BOT_CONTROL_PLANE_ROLE = [
  "/admin/bot — control plane: настройки, readiness, мониторинг внешнего Bot Core.",
  "Runtime бота, LLM-клиент, обработчики каналов и очередь не размещаются внутри Next.js.",
  "Bot Core взаимодействует с Booking Service только через ограниченные версионированные внутренние API.",
  "Прямой доступ Bot Core к PostgreSQL online-zapis-tv запрещён.",
  "Требуются service-to-service auth, idempotency и audit (пока не реализованы).",
  "Второй каталог услуг, второе расписание и копия Booking Service не создаются.",
] as const;

/**
 * Canonical connection order — do not reorder.
 * Phase 0 first; amoCRM before any live client channel.
 */
export const BOT_CONNECTION_PHASES = [
  {
    phase: 0,
    id: "internal_api",
    label: "Внутренние API-контракты",
    summary:
      "Каталог, мастера, availability, temporary hold, confirm booking, акции, GAME FLOW, адрес, заявки/handoff",
  },
  {
    phase: 1,
    id: "amocrm",
    label: "amoCRM",
    summary:
      "Единое окно менеджера: задачи, теги, источник, история, handoff, защита от параллельной обработки",
  },
  {
    phase: 2,
    id: "vk",
    label: "VK",
    summary: "Первый реальный клиентский канал сразу после amoCRM",
  },
  {
    phase: 3,
    id: "max",
    label: "MAX",
    summary:
      "После VK. Перед реализацией сверять актуальную официальную документацию (переход на platform-api2.max.ru)",
  },
  {
    phase: 4,
    id: "site",
    label: "Сайт (чат-виджет)",
    summary: "После MAX",
  },
  {
    phase: 5,
    id: "telegram",
    label: "Telegram",
    summary: "Поздний этап",
  },
  {
    phase: 6,
    id: "whatsapp",
    label: "WhatsApp",
    summary: "Отложенный future adapter/enum без runtime и без API на foundation",
  },
] as const;

export const BOT_CURRENT_PROJECT_PHASE = {
  phase: 0,
  id: "foundation_control_plane",
  label: "Этап 0 · Foundation / control plane",
  nextStep: "Спроектировать и проверить внутренние API-контракты Bot Core ↔ Booking Service",
  botCoreDeployed: false,
} as const;

export const BOT_FSM_PIPELINE =
  "ВХОД → КЛАССИФИКАЦИЯ → СЦЕНАРИЙ (FSM) → ОТВЕТ → ДЕЙСТВИЕ" as const;

export const BOT_FSM_SCENARIOS = [
  "ordinary_consultation",
  "game_flow",
  "active_campaign",
  "spam_irrelevant",
  "greeting_thanks",
  "permanent_makeup",
  "cosmetology",
  "massage",
  "velvet",
  "tattoo_removal",
  "future_reschedule",
] as const;

export const BOT_CORE_BOUNDARY_FORBIDDEN = [
  "LLM-клиент и runtime FSM внутри Next.js",
  "Прямой Prisma/PostgreSQL доступ из Bot Core",
  "Дублирование каталога услуг или расписания",
  "Свободный чат без FSM и tool-call allowlist",
  "Сбор телефона/имени в AI-переписке",
] as const;
