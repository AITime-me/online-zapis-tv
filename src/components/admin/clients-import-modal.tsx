"use client";

import { useRef, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import type { ClientAdminDto } from "@/types/client-admin";
import type {
  ClientImportCommitRow,
  ClientImportPreviewResult,
  ClientImportPreviewRow,
  ClientImportRowAction,
} from "@/types/client-import";

type ImportStep = "upload" | "preview" | "done";

type PreviewResponse = {
  ok: boolean;
  preview?: ClientImportPreviewResult;
  error?: string;
};

type CommitResponse = {
  ok: boolean;
  result?: {
    created: number;
    updated: number;
    failed: number;
    errors: Array<{ rowNumber: number; error: string }>;
  };
  clients?: ClientAdminDto[];
  error?: string;
};

const ACTION_LABELS: Record<ClientImportRowAction, string> = {
  create: "Создать",
  update: "Обновить",
  error: "Ошибка",
  duplicate: "Возможный дубль",
  skip: "Пропустить",
};

const ACTION_CLASS: Record<ClientImportRowAction, string> = {
  create: "bg-emerald-50 text-emerald-800",
  update: "bg-blue-50 text-blue-800",
  error: "bg-red-50 text-red-800",
  duplicate: "bg-amber-50 text-amber-900",
  skip: "bg-zinc-100 text-zinc-600",
};

export function ClientsImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (clients: ClientAdminDto[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ClientImportPreviewResult | null>(null);
  const [commitRows, setCommitRows] = useState<ClientImportCommitRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setResultMessage(null);
    setPreview(null);
    setCommitRows([]);
    setStep("upload");

    if (!file) {
      setFileName(null);
      setCsvText("");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Выберите CSV-файл");
      setFileName(null);
      setCsvText("");
      return;
    }

    try {
      const text = await file.text();
      setFileName(file.name);
      setCsvText(text);
    } catch {
      setError("Не удалось прочитать файл");
      setFileName(null);
      setCsvText("");
    }
  };

  const handlePreview = async () => {
    if (!csvText.trim()) {
      setError("Сначала выберите CSV-файл");
      return;
    }

    setChecking(true);
    setError(null);
    setResultMessage(null);

    try {
      const response = await fetch("/api/admin/clients/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const payload = await readApiJsonResponse<PreviewResponse>(response);

      if (!response.ok || !payload.ok || !payload.preview) {
        throw new Error(payload.error ?? "Не удалось проверить файл");
      }

      setPreview(payload.preview);
      setCommitRows(payload.preview.commitRows);
      setStep("preview");
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Не удалось проверить файл",
      );
    } finally {
      setChecking(false);
    }
  };

  const handleCommit = async () => {
    if (commitRows.length === 0) {
      setError("Нет строк для импорта");
      return;
    }

    setCommitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/clients/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: commitRows }),
      });
      const payload = await readApiJsonResponse<CommitResponse>(response);

      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Не удалось импортировать клиентов");
      }

      if (payload.clients) {
        onImported(payload.clients);
      }

      const { created, updated, failed } = payload.result;
      setResultMessage(
        `Импорт завершён: создано ${created}, обновлено ${updated}${
          failed > 0 ? `, ошибок ${failed}` : ""
        }.`,
      );
      setStep("done");
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : "Не удалось импортировать клиентов",
      );
    } finally {
      setCommitting(false);
    }
  };

  const summary = preview?.summary;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clients-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 id="clients-import-title" className="text-base font-semibold text-zinc-900">
              Импорт клиентов из CSV
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Сначала проверка файла и предпросмотр, затем подтверждение импорта
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            Закрыть
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          ) : null}

          {resultMessage ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {resultMessage}
            </div>
          ) : null}

          <section className="space-y-3 rounded border border-zinc-200 bg-zinc-50 p-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-800">CSV-файл</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void handleFileChange(event)}
                className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-50"
              />
            </label>
            {fileName ? (
              <p className="text-xs text-zinc-500">Выбран файл: {fileName}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={!csvText || checking || committing}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {checking ? "Проверка…" : "Проверить файл"}
              </button>
            </div>
          </section>

          {preview ? (
            <>
              <section className="grid gap-2 rounded border border-zinc-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryItem label="Всего строк" value={summary?.totalRows ?? 0} />
                <SummaryItem label="Будет создано" value={summary?.toCreate ?? 0} />
                <SummaryItem label="Будет обновлено" value={summary?.toUpdate ?? 0} />
                <SummaryItem label="Ошибки" value={summary?.errors ?? 0} />
                <SummaryItem label="Возможные дубли" value={summary?.duplicates ?? 0} />
                <SummaryItem label="Пропущено" value={summary?.skipped ?? 0} />
                {summary && summary.noContacts > 0 ? (
                  <SummaryItem label="Без контактов" value={summary.noContacts} />
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">Распознанные колонки</h3>
                <div className="flex flex-wrap gap-2">
                  {preview.columnMapping.map((column) => (
                    <span
                      key={`${column.header}-${column.field ?? "unused"}`}
                      className={`rounded px-2 py-1 text-xs ${
                        column.used
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {column.header}
                      {column.field ? ` → ${column.field}` : " (не используется)"}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">
                  Разделитель: {preview.delimiter === ";" ? "точка с запятой" : "запятая"}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Предпросмотр (первые {preview.previewRows.length} строк)
                </h3>
                <div className="overflow-x-auto rounded border border-zinc-200">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Строка</th>
                        <th className="px-3 py-2 font-medium">ФИО</th>
                        <th className="px-3 py-2 font-medium">Телефон</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Теги</th>
                        <th className="px-3 py-2 font-medium">Действие</th>
                        <th className="px-3 py-2 font-medium">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.previewRows.map((row) => (
                        <PreviewTableRow key={row.rowNumber} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            {step === "done" ? "Закрыть" : "Отмена"}
          </button>
          {step === "preview" ? (
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={committing || commitRows.length === 0}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {committing ? "Импорт…" : "Подтвердить импорт"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function PreviewTableRow({ row }: { row: ClientImportPreviewRow }) {
  return (
    <tr className="border-b border-zinc-100 last:border-b-0">
      <td className="px-3 py-2 text-zinc-600">{row.rowNumber}</td>
      <td className="px-3 py-2 text-zinc-900">{row.fullName}</td>
      <td className="px-3 py-2 text-zinc-700">{row.phone ?? "—"}</td>
      <td className="px-3 py-2 text-zinc-700">{row.email ?? "—"}</td>
      <td className="px-3 py-2 text-zinc-700">
        {row.tags.length > 0 ? row.tags.join(", ") : "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${ACTION_CLASS[row.action]}`}
        >
          {ACTION_LABELS[row.action]}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-zinc-600">{row.reason ?? "—"}</td>
    </tr>
  );
}
