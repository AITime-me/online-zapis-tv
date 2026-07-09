"use client";

import Link from "next/link";
import { useState } from "react";
import { isSystemLegalDocumentSlug } from "@/lib/legal-document/defaults";
import type { LegalDocumentDto } from "@/types/legal-document";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

export function LegalDocumentEditor({
  initialDocument,
}: {
  initialDocument: LegalDocumentDto;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const slugReadonly = isSystemLegalDocumentSlug(document.slug);

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  const saveDocument = async () => {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/legal-documents/${document.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.title,
          content: document.content,
          isPublished: document.isPublished,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.document) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      setDocument(payload.document);
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
          Изменения применяются после сохранения и сразу отображаются на публичной
          странице, если документ опубликован.
        </p>
        <Link
          href="/admin/settings/legal"
          className="text-sm font-medium text-zinc-700 hover:underline"
        >
          ← К списку документов
        </Link>
      </div>

      <section className="space-y-4 rounded border border-zinc-200 bg-zinc-50 p-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Название документа</span>
          <input
            value={document.title}
            onChange={(event) =>
              setDocument((current) => ({ ...current, title: event.target.value }))
            }
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Slug</span>
          <input
            value={document.slug}
            readOnly={slugReadonly}
            className={`${fieldClass} ${slugReadonly ? "bg-zinc-100 text-zinc-600" : ""}`}
          />
          {slugReadonly ? (
            <span className="text-xs text-zinc-500">
              Системный slug нельзя изменить.
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Текст документа</span>
          <textarea
            value={document.content}
            onChange={(event) =>
              setDocument((current) => ({ ...current, content: event.target.value }))
            }
            rows={24}
            className={`${fieldClass} min-h-[28rem] font-mono text-[13px] leading-relaxed`}
          />
        </label>

        <label className="flex items-start gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={document.isPublished}
            onChange={(event) =>
              setDocument((current) => ({
                ...current,
                isPublished: event.target.checked,
              }))
            }
            className="mt-0.5"
          />
          <span>Опубликован</span>
        </label>

        <div className="flex items-center gap-3">
          {statusLabel ? (
            <span className="text-sm text-zinc-500">{statusLabel}</span>
          ) : null}
          <button
            type="button"
            onClick={saveDocument}
            disabled={status === "saving"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </section>
    </div>
  );
}
