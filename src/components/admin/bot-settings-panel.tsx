"use client";

import { useEffect, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  BOT_FOUNDATION_CAPABILITIES,
  BOT_MODE_DESCRIPTIONS,
  BOT_MODE_LABELS,
  BOT_PROVIDER_LABELS,
  BOT_RESPONSE_MODE_DESCRIPTIONS,
  BOT_RESPONSE_MODE_LABELS,
  type BotChannels,
  type BotMode,
  type BotProvider,
  type BotResponseMode,
} from "@/lib/bot-settings/defaults";
import {
  BOT_EVENT_LEVEL_LABELS,
  BOT_EVENT_TYPE_LABELS,
  BOT_EVENT_TYPES,
  BOT_LOG_CAN_STORE,
  BOT_LOG_MUST_NOT_STORE,
} from "@/lib/bot-settings/event-log";
import type { BotSettingsDto, BotSettingsWriteInput } from "@/types/bot-settings";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type SettingsResponse = {
  ok: boolean;
  settings?: BotSettingsDto;
  error?: string;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500";
const labelClass = "text-xs font-medium text-zinc-700";
const sectionClass = "space-y-4 rounded border border-zinc-200 bg-white p-4";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toFormState(settings: BotSettingsDto) {
  return {
    isEnabled: settings.isEnabled,
    mode: settings.mode,
    provider: settings.provider,
    responseMode: settings.responseMode,
    channels: settings.channels,
    mainInstruction: settings.mainInstruction ?? "",
    knowledgeBaseNote: settings.knowledgeBaseNote ?? "",
    handoffRules: settings.handoffRules ?? "",
    taggingRules: settings.taggingRules ?? "",
    safetyRules: settings.safetyRules ?? "",
    maxMessagesPerClient: String(settings.maxMessagesPerClient),
    maxDailyMessages: String(settings.maxDailyMessages),
    logRetentionDays: String(settings.logRetentionDays),
    errorLogRetentionDays: String(settings.errorLogRetentionDays),
    maxStoredBotEvents: String(settings.maxStoredBotEvents),
  };
}

export function BotSettingsPanel({
  initialSettings,
  canEdit,
}: {
  initialSettings: BotSettingsDto;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [form, setForm] = useState(() => toFormState(initialSettings));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [eventsExpanded, setEventsExpanded] = useState(false);

  useEffect(() => {
    setSettings(initialSettings);
    setForm(toFormState(initialSettings));
  }, [initialSettings]);

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  const showIntegrationWarning =
    form.mode !== "OFF" || form.isEnabled || form.responseMode === "AUTO_LATER";

  const showNoOutboundWarning =
    form.mode === "TEST" || form.mode === "ENABLED_LATER" || form.isEnabled;

  const applySettings = (next: BotSettingsDto) => {
    setSettings(next);
    setForm(toFormState(next));
  };

  const buildPayload = (): BotSettingsWriteInput => ({
    isEnabled: form.isEnabled,
    mode: form.mode,
    provider: form.provider,
    responseMode: form.responseMode,
    channels: form.channels,
    mainInstruction: form.mainInstruction,
    knowledgeBaseNote: form.knowledgeBaseNote,
    handoffRules: form.handoffRules,
    taggingRules: form.taggingRules,
    safetyRules: form.safetyRules,
    maxMessagesPerClient: Number(form.maxMessagesPerClient),
    maxDailyMessages: Number(form.maxDailyMessages),
    logRetentionDays: Number(form.logRetentionDays),
    errorLogRetentionDays: Number(form.errorLogRetentionDays),
    maxStoredBotEvents: Number(form.maxStoredBotEvents),
  });

  const saveSettings = async () => {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/bot/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const payload = await readApiJsonResponse<SettingsResponse>(response);

      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Не удалось сохранить настройки");
      }

      applySettings(payload.settings);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить настройки",
      );
    }
  };

  const resetSettings = async () => {
    if (
      !window.confirm(
        "Сбросить настройки бота к значениям по умолчанию? Текущие изменения будут потеряны.",
      )
    ) {
      return;
    }

    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/admin/bot/settings/reset", {
        method: "POST",
      });
      const payload = await readApiJsonResponse<SettingsResponse>(response);

      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Не удалось сбросить настройки");
      }

      applySettings(payload.settings);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Не удалось сбросить настройки",
      );
    }
  };

  const updateChannel = (key: keyof BotChannels, value: boolean) => {
    setForm((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [key]: value,
      },
    }));
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">Foundation-раздел</p>
        <p className="mt-1">
          Сейчас это foundation-раздел. Бот не подключён к AI-провайдеру, не
          подключён к каналам и не отправляет сообщения клиентам.
        </p>
      </section>

      {!canEdit ? (
        <section className="rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          У вас доступ только на просмотр. Изменять настройки может владелец.
        </section>
      ) : null}

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Статус</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Бот</p>
            <p className="text-sm font-medium text-zinc-900">
              {BOT_MODE_LABELS[settings.mode]}
              {settings.isEnabled ? " · включён в конфиге" : " · выключен"}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Провайдер</p>
            <p className="text-sm font-medium text-zinc-900">
              {BOT_PROVIDER_LABELS[settings.provider]}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Режим ответа</p>
            <p className="text-sm font-medium text-zinc-900">
              {BOT_RESPONSE_MODE_LABELS[settings.responseMode]}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Последнее обновление</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(settings.updatedAt)}
            </p>
            {settings.updatedByUserName ? (
              <p className="text-xs text-zinc-500">{settings.updatedByUserName}</p>
            ) : null}
          </div>
        </div>

        {showIntegrationWarning ? (
          <p className="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Интеграции с каналами ещё не подключены. Бот не отправляет сообщения
            клиентам.
          </p>
        ) : null}
        {showNoOutboundWarning ? (
          <p className="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Даже при выбранном тестовом режиме или статусе «Готов к подключению»
            бот на текущем этапе не отправляет сообщения клиентам.
          </p>
        ) : null}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Настройки</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Статус бота</span>
            <select
              value={form.mode}
              disabled={!canEdit}
              onChange={(event) => {
                const mode = event.target.value as BotMode;
                setForm((current) => ({
                  ...current,
                  mode,
                  isEnabled: mode === "OFF" ? false : current.isEnabled,
                }));
              }}
              className={fieldClass}
            >
              {(Object.keys(BOT_MODE_LABELS) as BotMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {BOT_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">{BOT_MODE_DESCRIPTIONS[form.mode]}</p>
          </label>

          <label className="flex items-center gap-2 pt-5 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.isEnabled}
              disabled={!canEdit || form.mode === "OFF"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isEnabled: event.target.checked,
                }))
              }
            />
            Включить бота в конфигурации
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Провайдер</span>
            <select
              value={form.provider}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  provider: event.target.value as BotProvider,
                }))
              }
              className={fieldClass}
            >
              {(Object.keys(BOT_PROVIDER_LABELS) as BotProvider[]).map((provider) => (
                <option key={provider} value={provider}>
                  {BOT_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">
              Провайдер выбран заранее для будущего подключения. Сейчас запросы к
              AI не выполняются.
            </p>
          </label>

          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className={labelClass}>Режим ответа</span>
            <select
              value={form.responseMode}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  responseMode: event.target.value as BotResponseMode,
                }))
              }
              className={fieldClass}
            >
              {(Object.keys(BOT_RESPONSE_MODE_LABELS) as BotResponseMode[]).map(
                (responseMode) => (
                  <option key={responseMode} value={responseMode}>
                    {BOT_RESPONSE_MODE_LABELS[responseMode]}
                  </option>
                ),
              )}
            </select>
            <p className="text-xs text-zinc-500">
              {BOT_RESPONSE_MODE_DESCRIPTIONS[form.responseMode]}
            </p>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Лимит сообщений на клиента</span>
            <input
              type="number"
              min={1}
              value={form.maxMessagesPerClient}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxMessagesPerClient: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Дневной лимит сообщений</span>
            <input
              type="number"
              min={1}
              value={form.maxDailyMessages}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxDailyMessages: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Каналы</h2>
        <p className="text-xs text-zinc-500">
          Каналы сохраняются как будущая конфигурация. Подключение VK, MAX,
          Telegram и сайта будет реализовано отдельными этапами.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["siteWidget", "Сайт"],
              ["vk", "VK"],
              ["max", "MAX"],
              ["telegram", "Telegram"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={form.channels[key]}
                disabled={!canEdit}
                onChange={(event) => updateChannel(key, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Инструкции</h2>
        <div className="grid gap-4">
          {(
            [
              ["mainInstruction", "Основная инструкция"],
              ["knowledgeBaseNote", "База знаний / примечание"],
              ["handoffRules", "Правила передачи менеджеру"],
              ["taggingRules", "Правила тегирования"],
              ["safetyRules", "Правила безопасности"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className={labelClass}>{label}</span>
              <textarea
                rows={4}
                value={form[key]}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                className={fieldClass}
              />
            </label>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Что бот уже сможет использовать позже
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BOT_FOUNDATION_CAPABILITIES.map((item) => (
            <li
              key={item}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Будущее хранение логов
        </h2>
        <p className="text-xs text-zinc-500">
          Политика сохраняется в настройках. Реальная очистка логов появится
          после подключения бота и таблицы событий.
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          <li>Обычные события: {form.logRetentionDays} дней</li>
          <li>Ошибки: {form.errorLogRetentionDays} дней</li>
          <li>
            Показываются последние события, подробности раскрываются по клику
          </li>
          <li>Секреты, API-ключи и токены в логах не сохраняются</li>
        </ul>
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Обычные события, дней</span>
            <input
              type="number"
              min={1}
              value={form.logRetentionDays}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  logRetentionDays: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Ошибки, дней</span>
            <input
              type="number"
              min={1}
              value={form.errorLogRetentionDays}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  errorLogRetentionDays: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Максимум хранимых событий</span>
            <input
              type="number"
              min={1}
              value={form.maxStoredBotEvents}
              disabled={!canEdit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxStoredBotEvents: event.target.value,
                }))
              }
              className={fieldClass}
            />
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">События бота</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Логи появятся после подключения реального бота
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEventsExpanded((current) => !current)}
            className="text-sm font-medium text-[#1a73e8] hover:underline"
          >
            {eventsExpanded ? "Свернуть" : "Развернуть"}
          </button>
        </div>

        {eventsExpanded ? (
          <div className="space-y-4">
            <div className="rounded border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
              Событий пока нет. После подключения бота здесь будут отображаться
              последние события, ошибки и передачи менеджеру.
            </div>
            <p className="text-xs text-zinc-500">
              Логи будут храниться отдельными событиями, а не одним большим
              текстовым полем. Подробности события будут раскрываться по клику.
            </p>
            <p className="text-xs text-zinc-500">
              В будущем события будут отображаться списком: дата, уровень, канал,
              краткое событие. Подробности будут открываться внутри строки.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-zinc-700">Уровни</p>
                <ul className="mt-1 space-y-1 text-xs text-zinc-600">
                  {Object.entries(BOT_EVENT_LEVEL_LABELS).map(([level, label]) => (
                    <li key={level}>
                      {level} — {label}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-700">
                  Типы будущих событий
                </p>
                <ul className="mt-1 space-y-1 text-xs text-zinc-600">
                  {BOT_EVENT_TYPES.map((type) => (
                    <li key={type}>
                      {type} — {BOT_EVENT_TYPE_LABELS[type]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Безопасность логов
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-zinc-700">Нельзя хранить</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
              {BOT_LOG_MUST_NOT_STORE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-700">Можно хранить</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
              {BOT_LOG_CAN_STORE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        API-ключи OpenAI, Yandex, VK, MAX и Telegram не хранятся в базе данных.
        На сервере они должны храниться только в переменных окружения.
      </section>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={status === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Сохранить настройки
          </button>
          <button
            type="button"
            onClick={() => void resetSettings()}
            disabled={status === "saving"}
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          >
            Сбросить к значениям по умолчанию
          </button>
          {statusLabel ? (
            <span
              className={`text-sm ${
                status === "error" ? "text-red-700" : "text-zinc-600"
              }`}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
