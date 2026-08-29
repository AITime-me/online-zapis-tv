/**
 * Curated unfinished / launch status for /admin/bot.
 * This is a development/connection checklist — NOT live health monitoring
 * and NOT the backend AUTO readiness gate (see readiness.ts).
 *
 * Source: BOT-ADMIN-STATUS-RECONCILIATION-01.
 * Do not list items already working (OAuth lifecycle, handoff ownership,
 * live-facts/catalog, PII/redaction, S2S contract, settings/KB publications).
 */

export type BotLaunchStatusKind =
  | "not_connected"
  | "partial"
  | "not_implemented"
  | "needs_runtime_check";

export type BotLaunchStatusItem = {
  id: string;
  label: string;
  kind: BotLaunchStatusKind;
  detail?: string;
};

export const BOT_LAUNCH_STATUS_KIND_LABELS: Record<
  BotLaunchStatusKind,
  string
> = {
  not_connected: "Не подключено",
  partial: "Частично",
  not_implemented: "Не реализовано",
  needs_runtime_check: "Требует проверки",
};

export const BOT_LAUNCH_STATUS_DISCLAIMER =
  "Статус разработки и подключения — не live health-monitor и не readiness AUTO.";

/** Items intentionally omitted (already implemented) — for regression checks. */
export const BOT_LAUNCH_STATUS_OMITTED_IMPLEMENTED = [
  "amocrm_oauth_lifecycle",
  "amocrm_refresh_lifecycle",
  "amocrm_handoff_ownership",
  "live_facts_catalog_masters_availability",
  "pii_minimization",
  "log_redaction",
  "s2s_auth_contract",
  "settings_publications",
  "knowledge_publications",
] as const;

export const BOT_LAUNCH_STATUS_ITEMS: BotLaunchStatusItem[] = [
  // Не подключено
  {
    id: "yandex_provider_live",
    label: "YandexGPT / provider live wiring",
    kind: "not_connected",
    detail: "Factory есть; на reply path не подключён.",
  },
  {
    id: "provider_credentials_health",
    label: "Server credentials / provider health",
    kind: "not_connected",
    detail: "До runtime-доказательства не считаем подключённым.",
  },
  {
    id: "client_channel_vk",
    label: "Клиентский канал VK",
    kind: "not_connected",
    detail: "Есть VK master; клиентский канал не подключён.",
  },
  {
    id: "client_channel_max",
    label: "Клиентский канал MAX",
    kind: "not_connected",
  },
  {
    id: "client_channel_site",
    label: "Клиентский канал сайт",
    kind: "not_connected",
  },
  {
    id: "client_channel_telegram",
    label: "Клиентский канал Telegram",
    kind: "not_connected",
  },
  {
    id: "client_channel_whatsapp",
    label: "Клиентский канал WhatsApp",
    kind: "not_connected",
  },
  {
    id: "auto_outbound_client",
    label: "Auto-outbound клиенту",
    kind: "not_connected",
    detail: "Outbound policy deny-all для автоответов.",
  },
  {
    id: "bot_core_health_probe_cp",
    label: "Live Bot Core health probe из control plane",
    kind: "not_connected",
    detail: "Админка не опрашивает health Bot Core.",
  },

  // Частично
  {
    id: "dialogue_runtime_context",
    label: "Dialogue / runtime context",
    kind: "partial",
    detail: "Context foundation есть; LLM generation ещё нет.",
  },
  {
    id: "prompt_injection_boundary",
    label: "Prompt-injection защита",
    kind: "partial",
    detail: "Structural trust boundaries есть; полного фильтра нет.",
  },
  {
    id: "slot_ranking_recheck",
    label: "Slot ranking / final recheck",
    kind: "partial",
    detail: "Частично есть; temporary hold отсутствует.",
  },
  {
    id: "amocrm_tasks_tags",
    label: "amoCRM tasks / tags",
    kind: "partial",
    detail: "Tasks частично; tags write отсутствует.",
  },
  {
    id: "amocrm_webhook_coverage",
    label: "amoCRM webhook coverage",
    kind: "partial",
  },
  {
    id: "retention_enforcement",
    label: "Retention enforcement",
    kind: "partial",
    detail: "Значения в конфиге есть; enforcement неполный.",
  },
  {
    id: "monitoring_productization",
    label: "Monitoring productization",
    kind: "partial",
    detail: "Heartbeats есть; продуктовый monitor в admin нет.",
  },
  {
    id: "address_legal_bot_consent",
    label: "Address / legal bot-consent gaps",
    kind: "partial",
  },

  // Не реализовано
  {
    id: "classifier",
    label: "Classifier",
    kind: "not_implemented",
  },
  {
    id: "structured_output",
    label: "Structured output",
    kind: "not_implemented",
  },
  {
    id: "tool_call_allowlist",
    label: "Tool-call allowlist",
    kind: "not_implemented",
  },
  {
    id: "tone_post_filter",
    label: "Tone post-filter",
    kind: "not_implemented",
  },
  {
    id: "temporary_hold_api",
    label: "Temporary hold API",
    kind: "not_implemented",
  },
  {
    id: "client_channel_adapters",
    label: "Client channel adapters (runtime)",
    kind: "not_implemented",
    detail: "Кроме flags в конфиге adapters отсутствуют.",
  },
  {
    id: "campaign_bot_flows",
    label: "Campaign bot flows",
    kind: "not_implemented",
  },
  {
    id: "deletion_workflow",
    label: "Dedicated deletion workflow",
    kind: "not_implemented",
  },

  // Требует runtime-проверки
  {
    id: "prod_s2s_token",
    label: "Production S2S token / config presence",
    kind: "needs_runtime_check",
  },
  {
    id: "live_bot_core_health_admin",
    label: "Live Bot Core health from admin",
    kind: "needs_runtime_check",
  },
  {
    id: "effective_bot_mode_lock",
    label: "Effective BOT_MODE / EMERGENCY_LOCK",
    kind: "needs_runtime_check",
    detail: "На стороне bot-TV env; из admin не видно.",
  },
];

export function groupBotLaunchStatusItems(
  items: BotLaunchStatusItem[] = BOT_LAUNCH_STATUS_ITEMS,
): Record<BotLaunchStatusKind, BotLaunchStatusItem[]> {
  const empty: Record<BotLaunchStatusKind, BotLaunchStatusItem[]> = {
    not_connected: [],
    partial: [],
    not_implemented: [],
    needs_runtime_check: [],
  };
  for (const item of items) {
    empty[item.kind].push(item);
  }
  return empty;
}
