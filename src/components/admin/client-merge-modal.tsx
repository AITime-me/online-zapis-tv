"use client";

import { useEffect, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { getClientStatusLabel } from "@/lib/clients/defaults";
import type { ClientMergePreviewResult } from "@/types/client-merge";
import { MERGE_WARNING_LABELS } from "@/types/client-merge";

type MergeModalProps = {
  clientIds: string[];
  onClose: () => void;
  onMerged: () => void;
};

type PreviewResponse = {
  ok: boolean;
  preview?: ClientMergePreviewResult;
  error?: string;
};

type CommitResponse = {
  ok: boolean;
  error?: string;
};

export function ClientMergeModal({
  clientIds,
  onClose,
  onMerged,
}: MergeModalProps) {
  const [preview, setPreview] = useState<ClientMergePreviewResult | null>(null);
  const [targetClientId, setTargetClientId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadPreview = async (nextTargetClientId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/clients/merge/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIds,
          targetClientId: nextTargetClientId || undefined,
        }),
      });
      const payload = await readApiJsonResponse<PreviewResponse>(response);
      if (!response.ok || !payload.ok || !payload.preview) {
        throw new Error(payload.error ?? "Не удалось загрузить предпросмотр");
      }

      setPreview(payload.preview);
      setTargetClientId(
        nextTargetClientId || payload.preview.recommendedTargetClientId,
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Не удалось загрузить предпросмотр",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPreview();
  }, [clientIds]);

  const handleTargetChange = (nextTargetClientId: string) => {
    setTargetClientId(nextTargetClientId);
    void loadPreview(nextTargetClientId);
  };

  const handleCommit = async () => {
    if (!targetClientId) {
      setError("Выберите главного клиента");
      return;
    }

    const sourceClientIds = clientIds.filter((id) => id !== targetClientId);
    if (sourceClientIds.length === 0) {
      setError("Нет клиентов для объединения");
      return;
    }

    setCommitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/clients/merge/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetClientId,
          sourceClientIds,
          reason: reason.trim() || undefined,
        }),
      });
      const payload = await readApiJsonResponse<CommitResponse>(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Не удалось объединить клиентов");
      }

      setSuccessMessage("Клиенты объединены");
      onMerged();
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : "Не удалось объединить клиентов",
      );
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-merge-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-zinc-200 px-4 py-3">
          <h2 id="client-merge-title" className="text-base font-semibold text-zinc-900">
            Объединение клиентов
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Действие перенесёт связи на выбранного клиента. Физическое удаление не
            выполняется.
          </p>
        </header>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {successMessage}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-zinc-600">Загрузка предпросмотра…</p>
          ) : preview ? (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Выберите главного клиента
                </h3>
                <div className="space-y-2">
                  {preview.clients.map((client) => (
                    <label
                      key={client.id}
                      className={`flex cursor-pointer gap-3 rounded border p-3 ${
                        targetClientId === client.id
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name="merge-target"
                        checked={targetClientId === client.id}
                        onChange={() => handleTargetChange(client.id)}
                        disabled={committing || Boolean(successMessage)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium text-zinc-900">
                          {client.fullName}
                          {client.id === preview.recommendedTargetClientId ? (
                            <span className="ml-2 text-xs font-normal text-emerald-700">
                              рекомендуется
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          {client.phone ?? "—"} · {client.email ?? "—"} ·{" "}
                          {getClientStatusLabel(client.status)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Заявок: {client.bookingRequestCount} · Записей:{" "}
                          {client.appointmentCount}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              {preview.warnings.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-zinc-900">Предупреждения</h3>
                  <ul className="space-y-1 text-sm text-amber-900">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>• {MERGE_WARNING_LABELS[warning]}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="grid gap-2 sm:grid-cols-2">
                <PreviewStat
                  label="Заявок будет перенесено"
                  value={preview.counts.bookingRequestsToMove}
                />
                <PreviewStat
                  label="Записей будет перенесено"
                  value={preview.counts.appointmentsToMove}
                />
                <PreviewStat
                  label="Тегов после объединения"
                  value={preview.counts.tagsToMerge}
                />
                <PreviewStat
                  label="Заметок будет дополнено"
                  value={preview.counts.notesToAppend}
                />
                <PreviewStat
                  label="Бонусный баланс"
                  value={preview.counts.bonusBalanceTotal}
                />
                <PreviewStat
                  label="Общая сумма"
                  value={preview.counts.totalSpentTotal}
                />
              </section>

              {preview.mergedTagsPreview.length > 0 ? (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-900">Теги</h3>
                  <p className="text-sm text-zinc-700">
                    {preview.mergedTagsPreview.join(", ")}
                  </p>
                </section>
              ) : null}

              {preview.notesPreview ? (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-900">Заметки</h3>
                  <p className="whitespace-pre-line text-sm text-zinc-700">
                    {preview.notesPreview}
                  </p>
                </section>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-zinc-800">
                  Причина объединения
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={committing || Boolean(successMessage)}
                  rows={3}
                  className="rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
                  placeholder="Необязательно"
                />
              </label>
            </>
          ) : null}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            {successMessage ? "Закрыть" : "Отмена"}
          </button>
          {!successMessage ? (
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={committing || loading || !preview}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {committing ? "Объединение…" : "Подтвердить объединение"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
