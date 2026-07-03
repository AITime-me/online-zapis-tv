"use client";

import { useState } from "react";

type ExportStatus = {
  id: string;
  status: string;
  createdAt: string;
  fileName: string | null;
  errorMessage: string | null;
  downloadUrl: string | null;
};

type StatusResponse = {
  ok: boolean;
  latest: ExportStatus | null;
  latestSuccessful: ExportStatus | null;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EmergencyExportPanel({
  initialStatus,
}: {
  initialStatus: StatusResponse | null;
}) {
  const [statusData, setStatusData] = useState<StatusResponse | null>(
    initialStatus,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshStatus() {
    const response = await fetch("/api/emergency-export/status");
    const data = (await response.json()) as StatusResponse;
    setStatusData(data);
  }

  async function handleExportToday() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/emergency-export/today", {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        setError(data.error ?? "Не удалось сформировать выгрузку");
        await refreshStatus();
        return;
      }

      await refreshStatus();
    } catch {
      setError("Ошибка сети при формировании выгрузки");
    } finally {
      setLoading(false);
    }
  }

  const latest = statusData?.latest ?? null;
  const latestSuccessful =
    statusData?.latestSuccessful ?? statusData?.latest ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-zinc-200 p-4">
        <p className="text-sm text-zinc-600">
          Сформируйте XLSX-файл расписания на сегодня для аварийного доступа
          команды. Файл сохраняется локально в `exports/emergency`.
        </p>

        <button
          type="button"
          onClick={handleExportToday}
          disabled={loading}
          className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Формирование..." : "Сформировать выгрузку на сегодня"}
        </button>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Статус последней выгрузки</h2>

        {!latest ? (
          <p className="mt-3 text-sm text-zinc-600">Выгрузок пока не было.</p>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="font-medium text-zinc-500">Статус</dt>
              <dd>{latest.status}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Создана</dt>
              <dd>{formatDateTime(latest.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Файл</dt>
              <dd>{latest.fileName ?? "—"}</dd>
            </div>
            {latest.errorMessage ? (
              <div>
                <dt className="font-medium text-zinc-500">Ошибка</dt>
                <dd className="text-red-600">{latest.errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {latestSuccessful?.downloadUrl ? (
          <a
            href={latestSuccessful.downloadUrl}
            className="mt-4 inline-block rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Скачать последнюю выгрузку
          </a>
        ) : null}
      </section>
    </div>
  );
}
