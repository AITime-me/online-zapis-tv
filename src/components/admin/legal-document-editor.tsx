"use client";

import Link from "next/link";
import { useState } from "react";
import { isSystemLegalDocumentSlug } from "@/lib/legal-document/defaults";
import type { LegalDocumentAdminDto } from "@/types/legal-document";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

export function LegalDocumentEditor({
  initialDocument,
}: {
  initialDocument: LegalDocumentAdminDto;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [draftTitle, setDraftTitle] = useState(
    initialDocument.draftVersion?.title ??
      initialDocument.currentPublishedVersion?.title ??
      initialDocument.title,
  );
  const [draftContent, setDraftContent] = useState(
    initialDocument.draftVersion?.content ??
      initialDocument.currentPublishedVersion?.content ??
      "",
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const slugReadonly = isSystemLegalDocumentSlug(document.slug);
  const hasDraft = Boolean(document.draftVersion);
  const published = document.currentPublishedVersion;

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Готово"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  const runAction = async (
    action: "save-draft" | "publish" | "create-draft-from-published",
    confirmPublish = false,
  ) => {
    if (action === "publish") {
      if (!confirmPublish) {
        const ok = window.confirm(
          "Опубликовать текущий черновик? Он станет неизменяемой версией для сайта и согласий.",
        );
        if (!ok) return;
      }
    }

    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/legal-documents/${document.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          title: draftTitle,
          content: draftContent,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.document) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      const next = payload.document as LegalDocumentAdminDto;
      setDocument(next);
      setDraftTitle(
        next.draftVersion?.title ??
          next.currentPublishedVersion?.title ??
          next.title,
      );
      setDraftContent(
        next.draftVersion?.content ??
          next.currentPublishedVersion?.content ??
          "",
      );
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Опубликованный текст используется на публичных страницах и при фиксации
          согласий. Редактируется только черновик.
        </p>
        <Link
          href="/admin/settings/legal"
          className="text-sm font-medium text-zinc-700 hover:underline"
        >
          ← К списку документов
        </Link>
      </div>

      {published ? (
        <section className="space-y-2 rounded border border-emerald-200 bg-emerald-50/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">
            Опубликованная версия v{published.versionNumber}
          </h3>
          <p className="text-xs text-emerald-800">
            Hash: <code>{published.contentHash.slice(0, 16)}…</code>
            {published.publishedAt
              ? ` · ${new Date(published.publishedAt).toLocaleString("ru-RU")}`
              : null}
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-emerald-100 bg-white p-3 text-xs text-zinc-700">
            {published.content}
          </pre>
          {!hasDraft ? (
            <button
              type="button"
              onClick={() => void runAction("create-draft-from-published")}
              disabled={status === "saving"}
              className="rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
            >
              Создать черновик на основе опубликованной версии
            </button>
          ) : null}
        </section>
      ) : (
        <section className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Опубликованной версии пока нет. Сохраните черновик и опубликуйте его.
        </section>
      )}

      <section className="space-y-4 rounded border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="text-sm font-semibold text-zinc-900">
          {hasDraft ? "Черновик" : "Новый черновик"}
        </h3>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Название</span>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            className={fieldClass}
            disabled={Boolean(published) && !hasDraft}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Slug</span>
          <input
            value={document.slug}
            readOnly={slugReadonly}
            className={`${fieldClass} ${slugReadonly ? "bg-zinc-100 text-zinc-600" : ""}`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Текст черновика</span>
          <textarea
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            rows={20}
            className={`${fieldClass} min-h-[24rem] font-mono text-[13px] leading-relaxed`}
            disabled={Boolean(published) && !hasDraft}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {statusLabel ? (
            <span className="text-sm text-zinc-500">{statusLabel}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void runAction("save-draft")}
            disabled={status === "saving" || (Boolean(published) && !hasDraft)}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Сохранить черновик
          </button>
          <button
            type="button"
            onClick={() => void runAction("publish")}
            disabled={status === "saving" || !hasDraft}
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            Опубликовать версию
          </button>
        </div>
      </section>
    </div>
  );
}
