"use client";

import { useMemo, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  BOT_KNOWLEDGE_CATEGORIES,
  BOT_KNOWLEDGE_CATEGORY_LABELS,
  type BotKnowledgeCategoryId,
} from "@/lib/bot-knowledge/publication-contract";
import type {
  BotKnowledgeEntryDto,
  BotKnowledgePublicationStateDto,
  BotKnowledgePublicationSummaryDto,
  BotKnowledgeServiceOptionDto,
} from "@/types/bot-knowledge";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type EntriesResponse = {
  ok: boolean;
  entries?: BotKnowledgeEntryDto[];
  publicationState?: BotKnowledgePublicationStateDto;
  error?: string;
};

type EntryResponse = {
  ok: boolean;
  entry?: BotKnowledgeEntryDto;
  error?: string;
};

type PublishResponse = {
  ok: boolean;
  outcome?: "PUBLISHED" | "UNCHANGED";
  publication?: BotKnowledgePublicationSummaryDto;
  error?: string;
};

type ActivateResponse = {
  ok: boolean;
  publication?: BotKnowledgePublicationSummaryDto;
  error?: string;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500";
const labelClass = "text-xs font-medium text-zinc-700";
const sectionClass = "space-y-4 rounded border border-zinc-200 bg-white p-4";

function formatDateTime(value: string | null | undefined): string {
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

type EditorState = {
  id: string | null;
  stableKey: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tagsText: string;
  serviceId: string;
  isEnabled: boolean;
};

function emptyEditor(): EditorState {
  return {
    id: null,
    stableKey: "",
    category: "FAQ",
    title: "",
    content: "",
    tagsText: "",
    serviceId: "",
    isEnabled: true,
  };
}

function toEditor(entry: BotKnowledgeEntryDto): EditorState {
  return {
    id: entry.id,
    stableKey: entry.stableKey,
    category: entry.category,
    title: entry.title,
    content: entry.content,
    tagsText: entry.tags.join(", "),
    serviceId: entry.serviceId ?? "",
    isEnabled: entry.isEnabled,
  };
}

function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

type Props = {
  initialEntries: BotKnowledgeEntryDto[];
  initialPublicationState: BotKnowledgePublicationStateDto;
  serviceOptions: BotKnowledgeServiceOptionDto[];
  canEdit: boolean;
};

export function BotKnowledgePanel({
  initialEntries,
  initialPublicationState,
  serviceOptions,
  canEdit,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [publicationState, setPublicationState] = useState(initialPublicationState);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "archived">(
    "all",
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<SaveStatus>("idle");
  const [publishStatusLabel, setPublishStatusLabel] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (categoryFilter !== "all" && entry.category !== categoryFilter) {
        return false;
      }
      if (enabledFilter === "enabled" && !entry.isEnabled) {
        return false;
      }
      if (enabledFilter === "archived" && entry.isEnabled) {
        return false;
      }
      return true;
    });
  }, [entries, categoryFilter, enabledFilter]);

  async function refreshFromServer() {
    const response = await fetch("/api/admin/bot/knowledge/entries");
    const data = await readApiJsonResponse<EntriesResponse>(response);
    if (!response.ok || !data.ok || !data.entries || !data.publicationState) {
      throw new Error(data.error ?? "Не удалось обновить список");
    }
    setEntries(data.entries);
    setPublicationState(data.publicationState);
  }

  async function saveEntry() {
    if (!editor || !canEdit) {
      return;
    }
    setStatus("saving");
    setStatusLabel(null);

    const payload = {
      stableKey: editor.stableKey,
      category: editor.category,
      title: editor.title,
      content: editor.content,
      tags: parseTags(editor.tagsText),
      serviceId: editor.serviceId ? editor.serviceId : null,
      isEnabled: editor.isEnabled,
    };

    try {
      const response = await fetch(
        editor.id
          ? `/api/admin/bot/knowledge/entries/${editor.id}`
          : "/api/admin/bot/knowledge/entries",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editor.id
              ? {
                  category: payload.category,
                  title: payload.title,
                  content: payload.content,
                  tags: payload.tags,
                  serviceId: payload.serviceId,
                  isEnabled: payload.isEnabled,
                }
              : payload,
          ),
        },
      );
      const data = await readApiJsonResponse<EntryResponse>(response);
      if (!response.ok || !data.ok || !data.entry) {
        setStatus("error");
        setStatusLabel(data.error ?? "Ошибка сохранения");
        return;
      }
      await refreshFromServer();
      setEditor(toEditor(data.entry));
      setStatus("saved");
      setStatusLabel("Сохранено в workspace (не опубликовано)");
    } catch (error) {
      setStatus("error");
      setStatusLabel(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  }

  async function publishKnowledge() {
    if (!canEdit) {
      return;
    }
    setPublishStatus("saving");
    setPublishStatusLabel(null);
    try {
      const response = await fetch("/api/admin/bot/knowledge/publish", {
        method: "POST",
      });
      const data = await readApiJsonResponse<PublishResponse>(response);
      if (!response.ok || !data.ok || !data.publication) {
        setPublishStatus("error");
        setPublishStatusLabel(data.error ?? "Ошибка публикации");
        return;
      }
      await refreshFromServer();
      setPublishStatus("saved");
      setPublishStatusLabel(
        data.outcome === "UNCHANGED"
          ? "Без изменений (тот же checksum)"
          : `Опубликовано v${data.publication.versionNumber}`,
      );
    } catch (error) {
      setPublishStatus("error");
      setPublishStatusLabel(
        error instanceof Error ? error.message : "Ошибка публикации",
      );
    }
  }

  async function activatePublication(id: string) {
    if (!canEdit) {
      return;
    }
    setPublishStatus("saving");
    setPublishStatusLabel(null);
    try {
      const response = await fetch(
        `/api/admin/bot/knowledge/publications/${id}/activate`,
        { method: "POST" },
      );
      const data = await readApiJsonResponse<ActivateResponse>(response);
      if (!response.ok || !data.ok || !data.publication) {
        setPublishStatus("error");
        setPublishStatusLabel(data.error ?? "Ошибка активации");
        return;
      }
      await refreshFromServer();
      setPublishStatus("saved");
      setPublishStatusLabel(`Активирована v${data.publication.versionNumber}`);
    } catch (error) {
      setPublishStatus("error");
      setPublishStatusLabel(
        error instanceof Error ? error.message : "Ошибка активации",
      );
    }
  }

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">База знаний Теи</h2>
        <p className="text-xs text-zinc-600">
          Управляемые статьи для Теи. «Сохранить» меняет только workspace.
          Runtime видит только ACTIVE publication после «Опубликовать». Цены,
          слоты и каталог — только из live SoT, не из KB.
        </p>

        <div className="flex flex-wrap gap-3">
          <label className="space-y-1">
            <span className={labelClass}>Категория</span>
            <select
              className={fieldClass}
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Все</option>
              {BOT_KNOWLEDGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {BOT_KNOWLEDGE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Статус</span>
            <select
              className={fieldClass}
              value={enabledFilter}
              onChange={(event) =>
                setEnabledFilter(
                  event.target.value as "all" | "enabled" | "archived",
                )
              }
            >
              <option value="all">Все</option>
              <option value="enabled">Включённые</option>
              <option value="archived">Архив</option>
            </select>
          </label>
          {canEdit ? (
            <button
              type="button"
              className="self-end rounded border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              onClick={() => {
                setEditor(emptyEditor());
                setStatus("idle");
                setStatusLabel(null);
              }}
            >
              Создать
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-zinc-700">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500">
                <th className="py-2 pr-3">Ключ</th>
                <th className="py-2 pr-3">Категория</th>
                <th className="py-2 pr-3">Заголовок</th>
                <th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-3 font-mono text-[11px]">{entry.stableKey}</td>
                  <td className="py-2 pr-3">
                    {BOT_KNOWLEDGE_CATEGORY_LABELS[entry.category]}
                  </td>
                  <td className="py-2 pr-3">{entry.title}</td>
                  <td className="py-2 pr-3">
                    {entry.isEnabled ? "включена" : "архив"}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50"
                      onClick={() => {
                        setEditor(toEditor(entry));
                        setStatus("idle");
                        setStatusLabel(null);
                      }}
                    >
                      {canEdit ? "Редактировать" : "Просмотр"}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-zinc-500">
                    Записей пока нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {editor ? (
          <div className="space-y-3 rounded border border-zinc-100 bg-zinc-50 p-3">
            <p className="text-xs font-medium text-zinc-800">
              {editor.id ? "Редактирование entry" : "Новая entry"} · Save ≠ Publish
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>stableKey</span>
                <input
                  className={fieldClass}
                  value={editor.stableKey}
                  disabled={!canEdit || Boolean(editor.id)}
                  onChange={(event) =>
                    setEditor({ ...editor, stableKey: event.target.value })
                  }
                  placeholder="faq-aftercare-laser"
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Категория</span>
                <select
                  className={fieldClass}
                  value={editor.category}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      category: event.target.value as BotKnowledgeCategoryId,
                    })
                  }
                >
                  {BOT_KNOWLEDGE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {BOT_KNOWLEDGE_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className={labelClass}>Заголовок</span>
              <input
                className={fieldClass}
                value={editor.title}
                disabled={!canEdit}
                onChange={(event) =>
                  setEditor({ ...editor, title: event.target.value })
                }
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Контент</span>
              <textarea
                className={`${fieldClass} min-h-32`}
                value={editor.content}
                disabled={!canEdit}
                onChange={(event) =>
                  setEditor({ ...editor, content: event.target.value })
                }
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Теги (через запятую)</span>
                <input
                  className={fieldClass}
                  value={editor.tagsText}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setEditor({ ...editor, tagsText: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Услуга (linkage only)</span>
                <select
                  className={fieldClass}
                  value={editor.serviceId}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setEditor({ ...editor, serviceId: event.target.value })
                  }
                >
                  <option value="">— без привязки —</option>
                  {serviceOptions.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.publicName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={editor.isEnabled}
                disabled={!canEdit}
                onChange={(event) =>
                  setEditor({ ...editor, isEnabled: event.target.checked })
                }
              />
              Включена (попадёт в следующую публикацию)
            </label>
            {editor.content.trim() ? (
              <div className="rounded border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap">
                <p className="mb-1 font-medium text-zinc-500">Preview</p>
                {editor.content}
              </div>
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={status === "saving"}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50"
                  onClick={() => setEditor(null)}
                >
                  Закрыть
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
        ) : null}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-900">
          Публикация базы знаний
        </h2>
        <p className="text-xs text-zinc-600">
          Независима от публикации настроек бота. Rollback KB не откатывает
          settings и наоборот.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Draft updated</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(publicationState.workspaceUpdatedAt)}
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">ACTIVE version</p>
            <p className="text-sm font-medium text-zinc-900">
              {publicationState.active
                ? `v${publicationState.active.versionNumber}`
                : "не опубликовано"}
            </p>
            {publicationState.active ? (
              <p className="text-[10px] font-mono text-zinc-500">
                {publicationState.active.payloadChecksum.slice(0, 12)}…
              </p>
            ) : null}
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">ACTIVE publishedAt / entries</p>
            <p className="text-sm font-medium text-zinc-900">
              {formatDateTime(publicationState.active?.publishedAt)}
            </p>
            <p className="text-xs text-zinc-500">
              {publicationState.active?.entryCount ?? 0} в ACTIVE ·{" "}
              {publicationState.enabledEntryCount} enabled в draft
            </p>
          </div>
          <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-xs text-zinc-500">Статус</p>
            <p className="text-sm font-medium text-zinc-900">
              {publicationState.hasUnpublishedChanges
                ? "Есть неопубликованные изменения"
                : publicationState.active
                  ? "ACTIVE совпадает с workspace"
                  : "Требуется первая публикация"}
            </p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void publishKnowledge()}
              disabled={publishStatus === "saving" || status === "saving"}
              className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Опубликовать KB
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
                  <th className="py-2 pr-3">Entries</th>
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
                    <td className="py-2 pr-3">{row.entryCount}</td>
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
          <p className="text-xs text-zinc-500">История публикаций KB пока пуста.</p>
        )}
      </section>
    </div>
  );
}
