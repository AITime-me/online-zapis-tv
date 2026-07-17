"use client";

import Link from "next/link";
import type { LegalDocumentListItemDto, LegalReadinessDto } from "@/types/legal-document";

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function LegalDocumentsPanel({
  documents,
  readiness,
}: {
  documents: LegalDocumentListItemDto[];
  readiness: LegalReadinessDto;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Опубликованные версии показываются на публичных страницах и фиксируются в
          журнале согласий. Правка создаёт черновик; уже опубликованный текст
          неизменяем.
        </p>
        <Link
          href="/admin/settings"
          className="text-sm font-medium text-zinc-700 hover:underline"
        >
          ← К настройкам студии
        </Link>
      </div>

      <section
        className={`rounded border p-4 text-sm ${
          readiness.ready
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        <p className="font-medium">
          {readiness.ready
            ? "Readiness: обязательные документы опубликованы"
            : "Readiness: не хватает опубликованных документов"}
        </p>
        {!readiness.ready ? (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {readiness.missingRequiredSlugs.map((slug) => (
              <li key={slug}>
                Нет published-версии: <code>{slug}</code>
              </li>
            ))}
          </ul>
        ) : null}
        {!readiness.ready ? (
          <p className="mt-2">
            Заблокированы публичные формы: {readiness.blockedPublicForms.join(", ")}.
            Code fallback юридических текстов отсутствует.
          </p>
        ) : (
          <p className="mt-2">Code fallback юридических текстов отсутствует.</p>
        )}
      </section>

      <div className="overflow-hidden rounded border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Название</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium">Версия</th>
              <th className="px-4 py-3 font-medium">Обновлён</th>
              <th className="px-4 py-3 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {document.title}
                  {document.requiredForLaunch ? (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      обязателен
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      опционален для запуска
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                  {document.slug}
                  {document.publicPath ? (
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {document.publicPath}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      document.isPublished
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {document.isPublished ? "Опубликован" : "Нет публикации"}
                  </span>
                  {document.hasDraft ? (
                    <span className="ml-2 text-xs text-zinc-500">+ draft</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {document.currentPublishedVersionNumber
                    ? `v${document.currentPublishedVersionNumber}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {formatUpdatedAt(document.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/settings/legal/${document.slug}`}
                    className="font-medium text-[#1a73e8] hover:underline"
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
