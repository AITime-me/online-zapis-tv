import type { BotChannels, BotMode, BotProvider } from "@/lib/bot-settings/defaults";
import { BOT_TONE_OF_VOICE } from "@/lib/bot-settings/tone-of-voice";

export type BotReadinessGroupId =
  | "architecture"
  | "ai"
  | "channel"
  | "amocrm"
  | "booking"
  | "data_security";

export const BOT_READINESS_GROUP_LABELS: Record<BotReadinessGroupId, string> = {
  architecture: "Архитектура",
  ai: "AI",
  channel: "Канал",
  amocrm: "amoCRM",
  booking: "Booking",
  data_security: "Данные и безопасность",
};

export type BotReadinessCheckId =
  // architecture
  | "bot_core_endpoint"
  | "bot_core_health"
  | "service_to_service_auth"
  | "event_queue"
  | "idempotency"
  | "audit_trail"
  // ai
  | "yandex_provider"
  | "classifier_model"
  | "dialogue_model"
  | "server_side_credentials"
  | "structured_output"
  | "tool_call_allowlist"
  | "tone_post_filter"
  | "prompt_injection_boundary"
  // channel
  | "live_channel_current_phase"
  | "channel_webhook"
  | "signature_verification"
  | "replay_protection"
  | "rate_limits"
  | "outbound_health"
  // amocrm
  | "amocrm_oauth"
  | "amocrm_refresh_lifecycle"
  | "amocrm_webhook"
  | "amocrm_tasks_tags"
  | "amocrm_handoff_ownership"
  // booking
  | "catalog_api"
  | "masters_api"
  | "availability_api"
  | "ranked_slots"
  | "temporary_hold_api"
  | "final_slot_recheck"
  | "booking_validation"
  | "legal_form"
  | "address_source"
  // data / security
  | "pii_minimization"
  | "log_redaction"
  | "retention"
  | "deletion_workflow"
  | "monitoring"
  | "error_handling"
  // legacy ids kept for compatibility in reports (mapped into groups)
  | "logging"
  | "knowledge_snapshot"
  | "handoff"
  | "inbound_idempotency";

export type BotReadinessCheck = {
  id: BotReadinessCheckId;
  group: BotReadinessGroupId;
  label: string;
  ready: boolean;
  detail: string;
  requiredForAuto: true;
};

export type BotReadinessGroupReport = {
  id: BotReadinessGroupId;
  label: string;
  ready: boolean;
  readyCount: number;
  totalCount: number;
  checks: BotReadinessCheck[];
};

export type BotReadinessReport = {
  allReady: boolean;
  canEnableAuto: boolean;
  checks: BotReadinessCheck[];
  groups: BotReadinessGroupReport[];
  summary: string;
};

export type BotReadinessFlags = {
  // architecture
  hasBotCoreEndpoint?: boolean;
  hasBotCoreHealth?: boolean;
  hasServiceToServiceAuth?: boolean;
  hasEventQueue?: boolean;
  hasIdempotency?: boolean;
  hasAuditTrail?: boolean;
  // ai
  hasYandexProvider?: boolean;
  hasClassifierModel?: boolean;
  hasDialogueModel?: boolean;
  hasServerSideCredentials?: boolean;
  hasStructuredOutput?: boolean;
  hasToolCallAllowlist?: boolean;
  hasTonePostFilter?: boolean;
  hasPromptInjectionBoundary?: boolean;
  // channel
  hasLiveChannel?: boolean;
  hasChannelWebhook?: boolean;
  hasSignatureVerification?: boolean;
  hasReplayProtection?: boolean;
  hasRateLimitEnforcement?: boolean;
  hasOutboundHealth?: boolean;
  // amocrm
  hasAmoCrmOAuth?: boolean;
  hasAmoCrmRefreshLifecycle?: boolean;
  hasAmoCrmWebhook?: boolean;
  hasAmoCrmTasksTags?: boolean;
  hasAmoCrmHandoffOwnership?: boolean;
  // booking
  hasCatalogApi?: boolean;
  hasMastersApi?: boolean;
  hasAvailabilityApi?: boolean;
  hasRankedSlots?: boolean;
  hasTemporaryHoldApi?: boolean;
  hasFinalSlotRecheck?: boolean;
  hasBookingValidation?: boolean;
  hasLegalForm?: boolean;
  hasAddressSourceComplete?: boolean;
  // data
  hasPiiMinimization?: boolean;
  hasLogRedaction?: boolean;
  hasRetentionEnforcement?: boolean;
  hasDeletionWorkflow?: boolean;
  hasMonitoring?: boolean;
  hasErrorHandling?: boolean;
};

export type BotReadinessInput = {
  mode: BotMode;
  isEnabled: boolean;
  provider: BotProvider;
  channels: BotChannels;
} & BotReadinessFlags;

function check(
  id: BotReadinessCheckId,
  group: BotReadinessGroupId,
  label: string,
  ready: boolean,
  detail: string,
): BotReadinessCheck {
  return { id, group, label, ready, detail, requiredForAuto: true };
}

/**
 * Honest readiness for AUTO. Foundation: almost everything is not ready.
 * Any missing required check blocks AUTO.
 */
export function evaluateBotReadiness(input: BotReadinessInput): BotReadinessReport {
  const toneReady =
    Boolean(input.hasTonePostFilter) && BOT_TONE_OF_VOICE.postFilterImplemented;

  const checks: BotReadinessCheck[] = [
    // Architecture
    check(
      "bot_core_endpoint",
      "architecture",
      "Bot Core endpoint",
      Boolean(input.hasBotCoreEndpoint),
      input.hasBotCoreEndpoint
        ? "Endpoint Bot Core доступен"
        : "Внешний Bot Core не развёрнут; /admin/bot — только control plane",
    ),
    check(
      "bot_core_health",
      "architecture",
      "Bot Core health",
      Boolean(input.hasBotCoreHealth),
      input.hasBotCoreHealth ? "Health OK" : "Health Bot Core не проверен",
    ),
    check(
      "service_to_service_auth",
      "architecture",
      "Service-to-service auth",
      Boolean(input.hasServiceToServiceAuth),
      input.hasServiceToServiceAuth
        ? "S2S auth настроен"
        : "Аутентификация Bot Core ↔ Booking Service отсутствует",
    ),
    check(
      "event_queue",
      "architecture",
      "Очередь событий",
      Boolean(input.hasEventQueue),
      input.hasEventQueue ? "Очередь подключена" : "Очередь (Redis/RabbitMQ) не подключена",
    ),
    check(
      "idempotency",
      "architecture",
      "Idempotency",
      Boolean(input.hasIdempotency),
      input.hasIdempotency
        ? "Идемпотентность операций готова"
        : "Идемпотентность входящих/операций не реализована",
    ),
    check(
      "audit_trail",
      "architecture",
      "Audit trail",
      Boolean(input.hasAuditTrail),
      input.hasAuditTrail ? "Аудит действий ведётся" : "Audit trail действий бота отсутствует",
    ),

    // AI
    check(
      "yandex_provider",
      "ai",
      "Yandex Cloud provider",
      Boolean(input.hasYandexProvider),
      input.hasYandexProvider
        ? "Yandex Cloud AI Studio подключён"
        : "Целевой провайдер Yandex Cloud не подключён (в UI по умолчанию NONE)",
    ),
    check(
      "classifier_model",
      "ai",
      "Classifier model",
      Boolean(input.hasClassifierModel),
      input.hasClassifierModel
        ? "Классификатор настроен"
        : "Классификатор входящих сообщений не настроен",
    ),
    check(
      "dialogue_model",
      "ai",
      "Dialogue model",
      Boolean(input.hasDialogueModel),
      input.hasDialogueModel
        ? "Диалоговая модель настроена"
        : "Диалоговая модель FSM не настроена",
    ),
    check(
      "server_side_credentials",
      "ai",
      "Server-side credentials",
      Boolean(input.hasServerSideCredentials),
      input.hasServerSideCredentials
        ? "Секреты только на сервере"
        : "Серверные credentials отсутствуют; в БД/UI ключи не хранятся",
    ),
    check(
      "structured_output",
      "ai",
      "Structured output",
      Boolean(input.hasStructuredOutput),
      input.hasStructuredOutput
        ? "Structured output включён"
        : "Structured output / json schema не подключены",
    ),
    check(
      "tool_call_allowlist",
      "ai",
      "Tool-call allowlist",
      Boolean(input.hasToolCallAllowlist),
      input.hasToolCallAllowlist
        ? "Allowlist tool calls активен"
        : "Allowlist разрешённых tool calls отсутствует",
    ),
    check(
      "tone_post_filter",
      "ai",
      "Tone post-filter",
      toneReady,
      toneReady
        ? "Post-filter тона с тестами готов"
        : "Post-filter Tone of Voice обязателен до AUTO и ещё не реализован",
    ),
    check(
      "prompt_injection_boundary",
      "ai",
      "Prompt-injection boundary",
      Boolean(input.hasPromptInjectionBoundary),
      input.hasPromptInjectionBoundary
        ? "Граница prompt injection активна"
        : "Защита от prompt injection не внедрена",
    ),

    // Channel
    check(
      "live_channel_current_phase",
      "channel",
      "Живой канал текущего этапа",
      Boolean(input.hasLiveChannel),
      input.hasLiveChannel
        ? "Есть подключённый канал"
        : "Живых каналов нет. Канон: amoCRM → VK → MAX → сайт → Telegram → WhatsApp",
    ),
    check(
      "channel_webhook",
      "channel",
      "Webhook канала",
      Boolean(input.hasChannelWebhook),
      input.hasChannelWebhook ? "Webhook работает" : "Webhook канала не подключён",
    ),
    check(
      "signature_verification",
      "channel",
      "Проверка подписи",
      Boolean(input.hasSignatureVerification),
      input.hasSignatureVerification
        ? "Подпись проверяется"
        : "Signature verification отсутствует",
    ),
    check(
      "replay_protection",
      "channel",
      "Replay protection",
      Boolean(input.hasReplayProtection),
      input.hasReplayProtection
        ? "Replay protection включена"
        : "Защита от replay не реализована",
    ),
    check(
      "rate_limits",
      "channel",
      "Rate limits",
      Boolean(input.hasRateLimitEnforcement),
      input.hasRateLimitEnforcement
        ? "Rate limits применяются"
        : "Лимиты в настройках есть, enforcement отсутствует",
    ),
    check(
      "outbound_health",
      "channel",
      "Outbound health",
      Boolean(input.hasOutboundHealth),
      input.hasOutboundHealth
        ? "Исходящие сообщения здоровы"
        : "Outbound / отправка клиенту не подключена",
    ),

    // amoCRM
    check(
      "amocrm_oauth",
      "amocrm",
      "amoCRM OAuth",
      Boolean(input.hasAmoCrmOAuth),
      input.hasAmoCrmOAuth ? "OAuth готов" : "OAuth amoCRM не подключён",
    ),
    check(
      "amocrm_refresh_lifecycle",
      "amocrm",
      "Refresh token lifecycle",
      Boolean(input.hasAmoCrmRefreshLifecycle),
      input.hasAmoCrmRefreshLifecycle
        ? "Refresh lifecycle работает"
        : "Хранение/обновление refresh token вне BotSettings не настроено",
    ),
    check(
      "amocrm_webhook",
      "amocrm",
      "amoCRM webhook",
      Boolean(input.hasAmoCrmWebhook),
      input.hasAmoCrmWebhook
        ? "Webhook amoCRM здоров"
        : "Webhook amoCRM не подключён (нужен async + мгновенный 200)",
    ),
    check(
      "amocrm_tasks_tags",
      "amocrm",
      "Задачи и теги",
      Boolean(input.hasAmoCrmTasksTags),
      input.hasAmoCrmTasksTags
        ? "Задачи/теги работают"
        : "Создание задач и тегов ботом не реализовано",
    ),
    check(
      "amocrm_handoff_ownership",
      "amocrm",
      "Handoff ownership",
      Boolean(input.hasAmoCrmHandoffOwnership),
      input.hasAmoCrmHandoffOwnership
        ? "Владелец обращения контролируется"
        : "Handoff ownership и защита от двойной обработки отсутствуют",
    ),

    // Booking
    check(
      "catalog_api",
      "booking",
      "Catalog API для Bot Core",
      Boolean(input.hasCatalogApi),
      input.hasCatalogApi
        ? "Версионированный catalog API готов"
        : "Ограниченный internal catalog API для Bot Core ещё не зафиксирован",
    ),
    check(
      "masters_api",
      "booking",
      "Masters API для Bot Core",
      Boolean(input.hasMastersApi),
      input.hasMastersApi
        ? "Masters API готов"
        : "Ограниченный masters API для Bot Core ещё не зафиксирован",
    ),
    check(
      "availability_api",
      "booking",
      "Availability API",
      Boolean(input.hasAvailabilityApi),
      input.hasAvailabilityApi
        ? "Availability API для Bot Core готов"
        : "Канонический availability есть внутри Booking; отдельный Bot Core contract — gap",
    ),
    check(
      "ranked_slots",
      "booking",
      "Ранжированные слоты",
      Boolean(input.hasRankedSlots),
      input.hasRankedSlots
        ? "Ранжирование 2–3 окон готово"
        : "Умный подбор/ранжирование окон не реализованы",
    ),
    check(
      "temporary_hold_api",
      "booking",
      "Temporary hold API",
      Boolean(input.hasTemporaryHoldApi),
      input.hasTemporaryHoldApi
        ? "Временная бронь с TTL готова"
        : "API временной брони отсутствует — AUTO недоступен",
    ),
    check(
      "final_slot_recheck",
      "booking",
      "Final slot recheck",
      Boolean(input.hasFinalSlotRecheck),
      input.hasFinalSlotRecheck
        ? "Повторная проверка слота есть"
        : "Явный final recheck для Bot Core не выделен",
    ),
    check(
      "booking_validation",
      "booking",
      "Booking validation",
      Boolean(input.hasBookingValidation),
      input.hasBookingValidation
        ? "Создание записи только через booking workflow"
        : "Контракт подтверждения записи для Bot Core не готов",
    ),
    check(
      "legal_form",
      "booking",
      "Legal form (ПДн/оферта)",
      Boolean(input.hasLegalForm),
      input.hasLegalForm
        ? "Согласие/оферта в форме записи"
        : "Контактные данные и согласия только через форму Booking — контракт для бота не закрыт",
    ),
    check(
      "address_source",
      "booking",
      "Адрес из studio_settings",
      Boolean(input.hasAddressSourceComplete),
      input.hasAddressSourceComplete
        ? "Полный адресный профиль доступен"
        : "Есть studio_settings.address; map/ориентир/этаж/вход/домофон/«переехали» — gap без миграции",
    ),

    // Data & security
    check(
      "pii_minimization",
      "data_security",
      "PII minimization",
      Boolean(input.hasPiiMinimization),
      input.hasPiiMinimization
        ? "Минимизация ПДн активна"
        : "Runtime минимизации ПДн для Bot Core не внедрён",
    ),
    check(
      "log_redaction",
      "data_security",
      "Log redaction",
      Boolean(input.hasLogRedaction),
      input.hasLogRedaction
        ? "Редактура логов активна"
        : "Редактура сырой ПДн в логах не реализована",
    ),
    check(
      "retention",
      "data_security",
      "Retention",
      Boolean(input.hasRetentionEnforcement),
      input.hasRetentionEnforcement
        ? "Retention применяется"
        : "Сроки retention сохранены в настройках, enforcement отсутствует",
    ),
    check(
      "deletion_workflow",
      "data_security",
      "Deletion workflow",
      Boolean(input.hasDeletionWorkflow),
      input.hasDeletionWorkflow
        ? "Подтверждённое удаление данных готово"
        : "Административное удаление данных для бот-контура не оформлено",
    ),
    check(
      "monitoring",
      "data_security",
      "Monitoring",
      Boolean(input.hasMonitoring),
      input.hasMonitoring ? "Мониторинг подключён" : "Мониторинг Bot Core отсутствует",
    ),
    check(
      "error_handling",
      "data_security",
      "Error handling",
      Boolean(input.hasErrorHandling),
      input.hasErrorHandling
        ? "Обработка ошибок готова"
        : "Единый error handling Bot Core не подключён",
    ),
  ];

  const groupIds = Object.keys(BOT_READINESS_GROUP_LABELS) as BotReadinessGroupId[];
  const groups: BotReadinessGroupReport[] = groupIds.map((groupId) => {
    const groupChecks = checks.filter((c) => c.group === groupId);
    const readyCount = groupChecks.filter((c) => c.ready).length;
    return {
      id: groupId,
      label: BOT_READINESS_GROUP_LABELS[groupId],
      ready: groupChecks.length > 0 && readyCount === groupChecks.length,
      readyCount,
      totalCount: groupChecks.length,
      checks: groupChecks,
    };
  });

  const allReady = checks.every((c) => c.ready);
  const canEnableAuto = allReady;

  return {
    allReady,
    canEnableAuto,
    checks,
    groups,
    summary: allReady
      ? "Все обязательные readiness checks пройдены — AUTO можно включать."
      : "AUTO заблокирован: не все обязательные checks пройдены. Control plane не запускает Bot Core. Один чекбокс не включает бота.",
  };
}

/** Foundation defaults: no live Bot Core / integrations. */
export function evaluateFoundationBotReadiness(input: {
  mode: BotMode;
  isEnabled: boolean;
  provider: BotProvider;
  channels: BotChannels;
}): BotReadinessReport {
  return evaluateBotReadiness({
    ...input,
    // everything intentionally false / unset
  });
}
