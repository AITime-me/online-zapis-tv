/**
 * Target AI provider plan for Bot Core (external runtime).
 * No real credentials, model URIs or network calls in foundation.
 */

export const BOT_TARGET_AI_PROVIDER = {
  id: "YANDEX_CLOUD_AI_STUDIO",
  label: "Yandex Cloud AI Studio",
  role: "primary_target",
  detail:
    "Целевой основной провайдер внешнего Bot Core. OpenAI-совместимый endpoint Yandex Cloud; model URI настраиваются только на сервере.",
} as const;

export const BOT_RESERVE_AI_PROVIDER = {
  id: "OPENAI",
  label: "OpenAI",
  role: "future_reserve_escalation_only",
  detail:
    "Только возможный резерв/эскалация в будущем. Не обязательный основной контур.",
} as const;

export type BotModelRoleStatus = "not_configured" | "configured" | "healthy";

export type BotAiProviderFoundationStatus = {
  defaultProviderSetting: "NONE";
  targetProvider: typeof BOT_TARGET_AI_PROVIDER;
  reserveProvider: typeof BOT_RESERVE_AI_PROVIDER;
  classifier: {
    role: "classifier";
    label: "Классификатор входящего сообщения";
    status: BotModelRoleStatus;
    detail: string;
  };
  dialogue: {
    role: "dialogue";
    label: "Диалоговая модель внутри FSM";
    status: BotModelRoleStatus;
    detail: string;
  };
  serverCredentials: "absent" | "present";
  providerHealth: "not_checked" | "ok" | "error";
  notes: string[];
};

export function getBotAiProviderFoundationStatus(): BotAiProviderFoundationStatus {
  return {
    defaultProviderSetting: "NONE",
    targetProvider: BOT_TARGET_AI_PROVIDER,
    reserveProvider: BOT_RESERVE_AI_PROVIDER,
    classifier: {
      role: "classifier",
      label: "Классификатор входящего сообщения",
      status: "not_configured",
      detail: "Model URI и секреты настраиваются только сервером Bot Core. Сейчас не настроен.",
    },
    dialogue: {
      role: "dialogue",
      label: "Диалоговая модель внутри FSM",
      status: "not_configured",
      detail: "Диалог только внутри FSM-сценария. Сейчас не настроена.",
    },
    serverCredentials: "absent",
    providerHealth: "not_checked",
    notes: [
      "В BotSettings.provider по умолчанию NONE — выбор в UI ничего не подключает.",
      "Не хардкодить устаревающие имена моделей в бизнес-логике.",
      "Реальные AI-запросы, ключи в UI/БД и логирование промптов с ПДн запрещены на foundation.",
    ],
  };
}
