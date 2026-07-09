"use client";

import Link from "next/link";
import type { LegalDocumentListItemDto } from "@/types/legal-document";

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
}: {
  documents: LegalDocumentListItemDto[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">
          Редактируйте тексты юридических документов, которые отображаются на
          публичных страницах сайта.
        </p>
        <Link
          href="/admin/settings"
          className="text-sm font-medium text-zinc-700 hover:underline"
        >
          ← К настройкам студии
        </Link>
      </div>

      <div className="overflow-hidden rounded border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Название</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium">Обновлён</th>
              <th className="px-4 py-3 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-3 font-medium text-zinc-900">{document.title}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600">{document.slug}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      document.isPublished
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {document.isPublished ? "Опубликован" : "Черновик"}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {formatUpdatedAt(document.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/settings/legal/${document.slug}`}
                    className="font-medium text-[#1a73e8] hover:underline"
                  >
                    Редактировать
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
