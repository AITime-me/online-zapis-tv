"use client";

import { useEffect, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  BOT_CAN_DO,
  BOT_FOUNDATION_CAPABILITIES,
  BOT_MODE_DESCRIPTIONS,
  BOT_MODE_LABELS,
  BOT_MUST_HANDOFF,
  BOT_PROVIDER_LABELS,
  type BotChannels,
  type BotMode,
  type BotProvider,
} from "@/lib/bot-settings/defaults";
import {
  BOT_CONNECTION_PHASES,
  BOT_CONTROL_PLANE_ROLE,
  BOT_CURRENT_PROJECT_PHASE,
  BOT_FSM_PIPELINE,
} from "@/lib/bot-settings/architecture";
import {
  BOT_CAMPAIGN_ENGINE_GAPS,
  BOT_DISCOUNT_CALCULATION_POLICY,
  BOT_GAME_FLOW_POLICY,
  BOT_RESCHEDULE_OWNERSHIP_GAP,
  BOT_SLOT_STRATEGY_GAPS,
} from "@/lib/bot-settings/campaign-engine";
import {
  BOT_CRM_INTEGRATIONS,
  BOT_INTEGRATION_ARCHITECTURE_NOTES,
  BOT_MESSAGING_CHANNELS,
} from "@/lib/bot-settings/integrations";
import { getBotAiProviderFoundationStatus } from "@/lib/bot-settings/provider-plan";
import {
  BOT_PII_BOUNDARIES,
  BOT_TONE_OF_VOICE,
} from "@/lib/bot-settings/tone-of-voice";
import {
  BOT_LOG_CAN_STORE,
  BOT_LOG_MUST_NOT_STORE,
} from "@/lib/bot-settings/event-log";
import type { BotKnowledgeFoundationSummary } from "@/lib/bot-knowledge/types";
import type { BotSettingsDto, BotSettingsWriteInput } from "@/types/bot-settings";
import { BotEventLogsSection } from "@/components/admin/bot-event-logs-section";

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

const aiStatus = getBotAiProviderFoundationStatus();

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
  knowledgeSummary,
  canEdit,
}: {
  initialSettings: BotSettingsDto;
  knowledgeSummary: BotKnowledgeFoundationSummary;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [form, setForm] = useState(() => toFormState(initialSettings));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

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

  const readiness = settings.readiness;
  const autoBlocked = !readiness.canEnableAuto;

  const applySettings = (next: BotSettingsDto) => {
    setSettings(next);
    setForm(toFormState(next));
  };

  const buildPayload = (): BotSettingsWriteInput => ({
    isEnabled: form.isEnabled,
    mode: form.mode,
    provider: form.provider,
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
    if (key === "whatsapp") {
      return;
    }
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
        <p className="font-medium">Control plane · Bot Core не развёрнут</p>
        <p className="mt-1">
          {BOT_CURRENT_PROJECT_PHASE.label}. {BOT_CURRENT_PROJECT_PHASE.nextStep}.
          Выбор провайдера или канала в этой форме ничего не подключает и не
          отправляет сообщения клиентам.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
          {BOT_CONTROL_PLANE_ROLE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {!canEdit ? (
        <section className="rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          У вас доступ только на просмотр. Изменять настройки может владелец.
        </section>
      ) : null}

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Канонический порядок подключения
        </h2>
        <ol className="space-y-2 text-sm text-zinc-700">
          {BOT_CONNECTION_PHASES.map((phase) => (
            <li
              key={phase.id}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2"
            >
              <span className="font-medium text-zinc-900">
                Этап {phase.phase}. {phase.label}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {phase.summary}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Состояние</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Режим конфигурации</p>
            <p className="text-sm font-medium text-zinc-900">
              {BOT_MODE_LABELS[settings.mode]}
            </p>
            <p className="text-xs text-zinc-500">
              {settings.isEnabled
                ? "Флаг конфига: активен (не = live)"
                : "Флаг конфига: выключен"}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Провайдер в конфиге</p>
            <p className="text-sm font-medium text-zinc-900">
              {BOT_PROVIDER_LABELS[settings.provider]}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">AUTO readiness</p>
            <p className="text-sm font-medium text-zinc-900">
              {readiness.canEnableAuto ? "Готов" : "Заблокирован"}
            </p>
            <p className="text-xs text-zinc-500">
              {readiness.checks.filter((c) => c.ready).length}/
              {readiness.checks.length} checks
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
        <p className="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {readiness.summary}
        </p>
        <p className="text-xs text-zinc-500">FSM: {BOT_FSM_PIPELINE}</p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Готовность AUTO по группам
        </h2>
        <p className="text-xs text-zinc-500">
          Любой красный обязательный check блокирует AUTO. Tone post-filter пока
          не реализован.
        </p>
        <div className="space-y-3">
          {readiness.groups.map((group) => (
            <div
              key={group.id}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-900">{group.label}</p>
                <p className="text-xs text-zinc-500">
                  {group.readyCount}/{group.totalCount}
                  {group.ready ? " · OK" : " · не готово"}
                </p>
              </div>
              <ul className="mt-2 space-y-1">
                {group.checks.map((check) => (
                  <li key={check.id} className="flex gap-2 text-xs text-zinc-600">
                    <span
                      className={`shrink-0 font-semibold ${
                        check.ready ? "text-emerald-700" : "text-amber-800"
                      }`}
                    >
                      {check.ready ? "OK" : "Нет"}
                    </span>
                    <span>
                      <span className="font-medium text-zinc-800">
                        {check.label}:{" "}
                      </span>
                      {check.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Режим работы</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className={labelClass}>Режим конфигурации</span>
            <select
              value={form.mode}
              disabled={!canEdit}
              onChange={(event) => {
                const mode = event.target.value as BotMode;
                if (mode === "AUTO" && autoBlocked) {
                  setMessage(
                    "AUTO нельзя выбрать: не пройдены readiness checks.",
                  );
                  setStatus("error");
                  return;
                }
                setForm((current) => ({
                  ...current,
                  mode,
                  isEnabled: mode === "OFF" ? false : current.isEnabled,
                }));
              }}
              className={fieldClass}
            >
              {(Object.keys(BOT_MODE_LABELS) as BotMode[]).map((mode) => (
                <option
                  key={mode}
                  value={mode}
                  disabled={mode === "AUTO" && autoBlocked}
                >
                  {BOT_MODE_LABELS[mode]}
                  {mode === "AUTO" && autoBlocked ? " (заблокирован)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">{BOT_MODE_DESCRIPTIONS[form.mode]}</p>
            <p className="text-xs text-zinc-500">
              Целевой продуктовый режим — AUTO. HINTS — дополнительный безопасный
              режим, не конечная цель.
            </p>
          </label>

          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.isEnabled}
              disabled={!canEdit || form.mode === "OFF"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isEnabled: event.target.checked,
                }))
              }
            />
            <span>
              Пометить конфигурацию активной
              <span className="mt-1 block text-xs text-zinc-500">
                Не включает ответы клиентам и не обходит readiness.
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>AI-провайдер (конфиг)</span>
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
              {(Object.keys(BOT_PROVIDER_LABELS) as BotProvider[]).map(
                (provider) => (
                  <option key={provider} value={provider}>
                    {BOT_PROVIDER_LABELS[provider]}
                  </option>
                ),
              )}
            </select>
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
        <h2 className="text-sm font-semibold text-zinc-900">
          Целевой AI-провайдер (Bot Core)
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">Планируемый провайдер</p>
            <p className="font-medium text-zinc-900">
              {aiStatus.targetProvider.label}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">Резерв</p>
            <p className="font-medium text-zinc-900">
              {aiStatus.reserveProvider.label}
            </p>
            <p className="text-xs text-zinc-500">
              {aiStatus.reserveProvider.detail}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">{aiStatus.classifier.label}</p>
            <p className="font-medium text-zinc-900">Не настроен</p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">{aiStatus.dialogue.label}</p>
            <p className="font-medium text-zinc-900">Не настроена</p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">Server credentials</p>
            <p className="font-medium text-zinc-900">Отсутствуют</p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <p className="text-xs text-zinc-500">Provider health</p>
            <p className="font-medium text-zinc-900">Не проверен</p>
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-600">
          {aiStatus.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Каналы общения с клиентом
        </h2>
        <p className="text-xs text-zinc-500">
          Фаза подключения показана явно. Отметить канал ≠ подключить.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {BOT_MESSAGING_CHANNELS.map((channel) => {
            const key = channel.settingsKey;
            const checked =
              key && key !== "whatsapp" ? form.channels[key] : false;
            const disabled =
              !canEdit || channel.status === "deferred" || key === "whatsapp";

            return (
              <label
                key={channel.id}
                className="flex items-start gap-2 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(checked)}
                  disabled={disabled}
                  onChange={(event) => {
                    if (key && key !== "whatsapp") {
                      updateChannel(key, event.target.checked);
                    }
                  }}
                />
                <span>
                  <span className="font-medium text-zinc-900">
                    Этап {channel.phase}. {channel.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {channel.detail}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          CRM integration · amoCRM
        </h2>
        {BOT_CRM_INTEGRATIONS.map((crm) => (
          <div key={crm.id} className="space-y-3 text-sm text-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-zinc-900">
                Этап {crm.phase}. {crm.label}
              </p>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                Не подключён
              </span>
            </div>
            <p className="text-xs text-zinc-600">{crm.detail}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-zinc-700">Бот сможет</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
                  {crm.botMay.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-700">Бот не должен</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
                  {crm.botMustNot.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <ul className="space-y-1">
              {crm.readinessItems.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-2 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-amber-800">Нет</span>
                  <span>
                    <span className="font-medium text-zinc-800">
                      {item.label}:{" "}
                    </span>
                    {item.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-600">
          {BOT_INTEGRATION_ARCHITECTURE_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Knowledge sources
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              ["Категории", knowledgeSummary.counts.categories],
              ["Услуги", knowledgeSummary.counts.services],
              ["Мастера", knowledgeSummary.counts.masters],
              ["Акции", knowledgeSummary.counts.promotions],
              ["Игровые подарки", knowledgeSummary.counts.gameGifts],
            ] as const
          ).map(([label, count]) => (
            <div
              key={label}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2"
            >
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-sm font-medium text-zinc-900">{count}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 space-y-1">
          {knowledgeSummary.sources.map((source) => (
            <li
              key={source.id}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
            >
              <span className="font-medium text-zinc-900">{source.label}</span>
              <span className="text-zinc-500"> · {source.truthSource}</span>
              <span className="text-amber-800"> · {source.status}</span>
              {source.publicEntityCount != null ? (
                <span className="text-zinc-500">
                  {" "}
                  · {source.publicEntityCount}
                </span>
              ) : null}
              <span className="mt-0.5 block text-zinc-600">{source.detail}</span>
            </li>
          ))}
        </ul>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-600">
          {knowledgeSummary.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Capabilities и поведение
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BOT_FOUNDATION_CAPABILITIES.map((item) => (
            <li
              key={item.id}
              className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            >
              <p className="font-medium text-zinc-900">{item.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{item.detail}</p>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-zinc-700">Бот сможет сам</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
              {BOT_CAN_DO.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-700">
              Обязательный handoff
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-600">
              {BOT_MUST_HANDOFF.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Tone of Voice и ПДн
        </h2>
        <p className="text-xs text-zinc-600">
          Стиль: {BOT_TONE_OF_VOICE.style.join(", ")}. Обращение на «
          {BOT_TONE_OF_VOICE.addressForm}». Post-filter для AUTO:{" "}
          {BOT_TONE_OF_VOICE.postFilterImplemented
            ? "реализован"
            : "не реализован (AUTO красный)"}.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-600">
            {BOT_TONE_OF_VOICE.rules.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {BOT_TONE_OF_VOICE.medicalForbidden.map((item) => (
              <li key={item}>{item}</li>
            ))}
            <li>Запрещённая фраза: «{BOT_TONE_OF_VOICE.bannedPhrases[0]}»</li>
          </ul>
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-600">
            {BOT_PII_BOUNDARIES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Зафиксированные gaps
        </h2>
        <ul className="space-y-2 text-xs text-zinc-600">
          {BOT_CAMPAIGN_ENGINE_GAPS.map((gap) => (
            <li key={gap.id}>
              Campaign: {gap.label} — {gap.status}
            </li>
          ))}
          {BOT_SLOT_STRATEGY_GAPS.map((gap) => (
            <li key={gap.id}>
              Slots: {gap.label} — {gap.status}
            </li>
          ))}
          <li>
            Reschedule ownership ({BOT_RESCHEDULE_OWNERSHIP_GAP.owners.join(" | ")})
            — {BOT_RESCHEDULE_OWNERSHIP_GAP.status}
          </li>
          <li>
            Discount: только {BOT_DISCOUNT_CALCULATION_POLICY.engine}; DB
            promotion = {BOT_DISCOUNT_CALCULATION_POLICY.dbPromotionRole}
          </li>
          <li>{BOT_GAME_FLOW_POLICY.outdatedExampleNote}</li>
          <li>{BOT_GAME_FLOW_POLICY.formulaSiyaniyaPolicy}</li>
        </ul>
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
          Политика хранения логов
        </h2>
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

      <BotEventLogsSection />

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
        API-ключи Yandex Cloud, OpenAI, VK, MAX, Telegram, WhatsApp и amoCRM не
        хранятся в BotSettings и не отдаются в API. Только server secret store.
        Внешние сетевые вызовы с этой страницы не выполняются.
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
