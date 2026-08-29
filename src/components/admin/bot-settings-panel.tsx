"use client";

import { useEffect, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  BOT_MODE_DESCRIPTIONS,
  BOT_MODE_LABELS,
  BOT_PROVIDER_LABELS,
  type BotChannels,
  type BotMode,
  type BotProvider,
} from "@/lib/bot-settings/defaults";
import { BOT_MESSAGING_CHANNELS } from "@/lib/bot-settings/integrations";
import type { BotKnowledgeFoundationSummary } from "@/lib/bot-knowledge/types";
import { isClosedTestConsoleVisible } from "@/lib/bot-core/closed-test-gate";
import type { BotSettingsDto, BotSettingsWriteInput } from "@/types/bot-settings";
import type {
  BotSettingsPublicationStateDto,
  BotSettingsPublicationSummaryDto,
} from "@/types/bot-settings-publication";
import type { BotKnowledgePublicationStateDto } from "@/types/bot-knowledge";
import { BotClosedTestConsole } from "@/components/admin/bot-closed-test-console";
import { BotEventLogsSection } from "@/components/admin/bot-event-logs-section";
import { BotLaunchStatusPanel } from "@/components/admin/bot-launch-status-panel";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type SettingsResponse = {
  ok: boolean;
  settings?: BotSettingsDto;
  error?: string;
};

type PublicationStateResponse = {
  ok: boolean;
  state?: BotSettingsPublicationStateDto;
  publications?: BotSettingsPublicationSummaryDto[];
  error?: string;
};

type PublishResponse = {
  ok: boolean;
  outcome?: "PUBLISHED" | "UNCHANGED";
  publication?: BotSettingsPublicationSummaryDto;
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

function publicationStatusLabel(
  state: BotSettingsPublicationStateDto | BotKnowledgePublicationStateDto,
): string {
  if (state.hasUnpublishedChanges) {
    return "Есть неопубликованные изменения";
  }
  if (state.active) {
    return "ACTIVE совпадает с DRAFT";
  }
  return "Требуется первая публикация";
}

export function BotSettingsPanel({
  initialSettings,
  initialPublicationState,
  knowledgePublicationState,
  knowledgeSummary,
  canEdit,
}: {
  initialSettings: BotSettingsDto;
  initialPublicationState: BotSettingsPublicationStateDto;
  knowledgePublicationState: BotKnowledgePublicationStateDto;
  knowledgeSummary: BotKnowledgeFoundationSummary;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [publicationState, setPublicationState] = useState(initialPublicationState);
  const [form, setForm] = useState(() => toFormState(initialSettings));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [publishStatus, setPublishStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettings(initialSettings);
    setForm(toFormState(initialSettings));
  }, [initialSettings]);

  useEffect(() => {
    setPublicationState(initialPublicationState);
  }, [initialPublicationState]);

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  // Backend AUTO gate stays fail-closed via readiness.canEnableAuto.
  // Do not surface the 40 foundation checks as live monitoring.
  const autoBlocked = !settings.readiness.canEnableAuto;

  const applySettings = (next: BotSettingsDto) => {
    setSettings(next);
    setForm(toFormState(next));
  };

  const refreshPublicationState = async () => {
    const response = await fetch("/api/admin/bot/settings/publications?limit=8");
    const payload = await readApiJsonResponse<PublicationStateResponse>(response);
    if (response.ok && payload.ok && payload.state) {
      setPublicationState(payload.state);
    }
  };

  const publishSettings = async () => {
    setPublishStatus("saving");
    setPublishMessage(null);
    try {
      const response = await fetch("/api/admin/bot/settings/publish", {
        method: "POST",
      });
      const payload = await readApiJsonResponse<PublishResponse>(response);
      if (!response.ok || !payload.ok || !payload.publication) {
        throw new Error(payload.error ?? "Не удалось опубликовать настройки");
      }
      await refreshPublicationState();
      setPublishStatus("saved");
      setPublishMessage(
        payload.outcome === "UNCHANGED"
          ? "Изменений нет — ACTIVE версия уже актуальна"
          : `Опубликована версия v${payload.publication.versionNumber}`,
      );
      window.setTimeout(() => setPublishStatus("idle"), 2000);
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(
        error instanceof Error ? error.message : "Не удалось опубликовать настройки",
      );
    }
  };

  const activatePublication = async (publicationId: string) => {
    if (
      !window.confirm(
        "Активировать выбранную опубликованную версию? Текущая ACTIVE будет заменена.",
      )
    ) {
      return;
    }
    setPublishStatus("saving");
    setPublishMessage(null);
    try {
      const response = await fetch(
        `/api/admin/bot/settings/publications/${encodeURIComponent(publicationId)}/activate`,
        { method: "POST" },
      );
      const payload = await readApiJsonResponse<PublishResponse>(response);
      if (!response.ok || !payload.ok || !payload.publication) {
        throw new Error(payload.error ?? "Не удалось активировать версию");
      }
      await refreshPublicationState();
      setPublishStatus("saved");
      setPublishMessage(`Активирована версия v${payload.publication.versionNumber}`);
      window.setTimeout(() => setPublishStatus("idle"), 2000);
    } catch (error) {
      setPublishStatus("error");
      setPublishMessage(
        error instanceof Error ? error.message : "Не удалось активировать версию",
      );
    }
  };

  const saveSettings = async () => {
    setStatus("saving");
    setMessage(null);
    try {
      const body: BotSettingsWriteInput = {
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
      };
      const response = await fetch("/api/admin/bot/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readApiJsonResponse<SettingsResponse>(response);
      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Не удалось сохранить настройки");
      }
      applySettings(payload.settings);
      await refreshPublicationState();
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
    if (!window.confirm("Сбросить настройки к значениям по умолчанию?")) {
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
      await refreshPublicationState();
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Не удалось сбросить настройки",
      );
    }
  };

  const publishStatusLabel =
    publishStatus === "saving"
      ? "Публикую..."
      : publishStatus === "saved"
        ? publishMessage
        : publishStatus === "error"
          ? publishMessage
          : null;

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
      {!canEdit ? (
        <section className="rounded border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          У вас доступ только на просмотр. Изменять настройки может владелец.
        </section>
      ) : null}

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Состояние</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
            <p className="text-xs text-zinc-500">Публикация настроек</p>
            <p className="text-sm font-medium text-zinc-900">
              {publicationState.active
                ? `ACTIVE v${publicationState.active.versionNumber}`
                : "не опубликовано"}
            </p>
            <p className="text-xs text-zinc-500">
              {publicationStatusLabel(publicationState)}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Публикация KB</p>
            <p className="text-sm font-medium text-zinc-900">
              {knowledgePublicationState.active
                ? `ACTIVE v${knowledgePublicationState.active.versionNumber}`
                : "не опубликовано"}
            </p>
            <p className="text-xs text-zinc-500">
              {publicationStatusLabel(knowledgePublicationState)}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Последнее изменение</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(settings.updatedAt)}
            </p>
            {settings.updatedByUserName ? (
              <p className="text-xs text-zinc-500">{settings.updatedByUserName}</p>
            ) : null}
          </div>
        </div>
        <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          Автоответ клиентам пока не активирован. Выбор AUTO в конфиге заблокирован
          fail-closed до реального подключения провайдера, каналов и защиты.
        </p>
      </section>

      <BotLaunchStatusPanel />

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Публикация настроек</h2>
        <p className="text-xs text-zinc-600">
          Черновик (DRAFT) сохраняется отдельно. Bot Core получит только ACTIVE
          published snapshot через S2S. EMERGENCY_LOCK и effective BOT_MODE
          остаются на стороне bot-TV env.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">DRAFT updatedAt</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(publicationState.draftUpdatedAt)}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">ACTIVE version</p>
            <p className="text-sm font-medium text-zinc-900">
              {publicationState.active
                ? `v${publicationState.active.versionNumber}`
                : "не опубликовано"}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">ACTIVE publishedAt</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(publicationState.active?.publishedAt ?? null)}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Статус</p>
            <p className="text-sm font-medium text-zinc-900">
              {publicationStatusLabel(publicationState)}
            </p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void publishSettings()}
              disabled={publishStatus === "saving" || status === "saving"}
              className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Опубликовать
            </button>
            {publishStatusLabel ? (
              <span
                className={`text-sm ${
                  publishStatus === "error" ? "text-red-700" : "text-zinc-600"
                }`}
              >
                {publishStatusLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        {publicationState.recentPublications.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-zinc-700">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500">
                  <th className="py-2 pr-3">Версия</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Опубликовано</th>
                  <th className="py-2 pr-3">Checksum</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {publicationState.recentPublications.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 font-medium">v{row.versionNumber}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                    <td className="py-2 pr-3">{formatDateTime(row.publishedAt)}</td>
                    <td className="py-2 pr-3 font-mono text-[10px]">
                      {row.payloadChecksum.slice(0, 12)}…
                    </td>
                    <td className="py-2 pr-3">
                      {canEdit && row.status !== "ACTIVE" ? (
                        <button
                          type="button"
                          onClick={() => void activatePublication(row.id)}
                          disabled={publishStatus === "saving"}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60"
                        >
                          Активировать
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">История публикаций пока пуста.</p>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Управление Теей</h2>
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
                    "AUTO нельзя выбрать: автоответ клиентам пока не активирован.",
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
                  {mode === "AUTO" && autoBlocked ? " (не активирован)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500">{BOT_MODE_DESCRIPTIONS[form.mode]}</p>
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
                Не включает ответы клиентам и не обходит fail-closed AUTO gate.
              </span>
            </span>
          </label>

          {isClosedTestConsoleVisible(settings) ? (
            <div className="lg:col-span-2">
              <BotClosedTestConsole canEdit={canEdit} />
            </div>
          ) : null}

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
            <p className="text-xs text-zinc-500">
              Выбор в конфиге не подключает YandexGPT и не запускает live-запросы.
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
        <h2 className="text-sm font-semibold text-zinc-900">
          Каналы общения с клиентом
        </h2>
        <p className="text-xs text-zinc-500">
          Флаги конфигурации. Отметить канал ≠ подключить runtime.
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
                    {channel.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {channel.status === "deferred"
                      ? "Отложен · runtime не подключён"
                      : "Флаг конфига · runtime не подключён"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">Данные студии</h2>
        <p className="text-xs text-zinc-500">
          Справочник из booking SoT. Не readiness и не health Bot Core.
        </p>
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
