"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListPaginationBar } from "@/components/admin/list-pagination-bar";
import { COMM_CTA_LINK_HINT } from "@/lib/communications/cta-link-policy";
import { COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE } from "@/lib/communications/connector";
import {
  COMM_CONTACT_LIST_PAGE_SIZES,
  DEFAULT_COMM_CONTACT_LIST_FILTERS,
  DEFAULT_COMM_CONTACT_LIST_PAGE_SIZE,
  buildCommContactsListUrl,
  type CommContactListFilters,
} from "@/lib/communications/list-contract";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import type {
  CommAnalyticsSummary,
  CommCampaignButtonInput,
  CommCampaignDto,
  CommCampaignPreview,
  CommContactListItem,
  CommImportPreviewResult,
  CommSegmentDto,
} from "@/types/communications";
import {
  COMM_BUTTON_STYLE_LABELS,
  COMM_BUTTON_TYPE_LABELS,
  COMM_CAMPAIGN_STATUS_LABELS,
  COMM_CONSENT_STATUS_LABELS,
  COMM_DELIVERY_STATUS_LABELS,
  COMM_SOURCE_LABELS,
} from "@/types/communications";

type TabId = "audience" | "import" | "segments" | "campaigns" | "stats";

type FoundationState = {
  bannerMessage: string;
  connector: {
    vkConnectorReady: boolean;
    canSchedule: boolean;
    canRun: boolean;
    message: string;
  };
  counts: {
    contactsTotal: number;
    eligibleHint: number;
    campaignsTotal: number;
    importJobsTotal: number;
  };
};

type CommunicationsPanelProps = {
  initialFoundation: FoundationState;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const hintClass = "mt-0.5 text-xs text-zinc-500";
const filterClass =
  "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "audience", label: "Аудитория" },
  { id: "import", label: "Импорт" },
  { id: "segments", label: "Сегменты" },
  { id: "campaigns", label: "Рассылки" },
  { id: "stats", label: "Статистика" },
];

const DEFAULT_BUTTONS: CommCampaignButtonInput[] = [
  {
    text: "Хочу",
    type: "REPLY_TEXT",
    buttonKey: "want",
    action: "Хочу",
    style: "PRIMARY",
    sortOrder: 0,
  },
  {
    text: "Выбрать время",
    type: "OPEN_LINK",
    buttonKey: "book",
    url: "/booking",
    style: "POSITIVE",
    sortOrder: 1,
  },
  {
    text: "Не получать рассылки",
    type: "UNSUBSCRIBE",
    buttonKey: "unsubscribe",
    style: "NEGATIVE",
    sortOrder: 2,
  },
];

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString("ru-RU");
  } catch {
    return "—";
  }
}

export function CommunicationsPanel({
  initialFoundation,
}: CommunicationsPanelProps) {
  const [tab, setTab] = useState<TabId>("audience");
  const [foundation] = useState(initialFoundation);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        {foundation.bannerMessage || COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === item.id
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-800 ring-1 ring-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "audience" ? <AudienceTab /> : null}
      {tab === "import" ? <ImportTab /> : null}
      {tab === "segments" ? <SegmentsTab /> : null}
      {tab === "campaigns" ? <CampaignsTab /> : null}
      {tab === "stats" ? <StatsTab /> : null}
    </div>
  );
}

function AudienceTab() {
  const [filters, setFilters] = useState<CommContactListFilters>(
    DEFAULT_COMM_CONTACT_LIST_FILTERS,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_COMM_CONTACT_LIST_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CommContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [showTechIds, setShowTechIds] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = buildCommContactsListUrl({ page, pageSize, filters });
      const response = await fetch(url, { cache: "no-store" });
      const data = await readApiJsonResponse<{
        ok: boolean;
        contacts?: CommContactListItem[];
        total?: number;
        error?: string;
      }>(response);
      if (!data.ok) {
        throw new Error(data.error || "Не удалось загрузить аудиторию");
      }
      setContacts(data.contacts ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Контакты коммуникаций — отдельная сущность, не CRM-клиенты. Телефон и email
        сюда не импортируются.
      </p>

      <div className="grid gap-2 rounded border border-zinc-200 bg-white p-3 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Поиск по имени</span>
          <input
            className={fieldClass}
            value={filters.search}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                search: event.target.value,
              }));
            }}
            placeholder="Отображаемое имя"
          />
          <span className={hintClass}>VK ID не используется как основное имя.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Источник</span>
          <select
            className={filterClass}
            value={filters.source}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                source: event.target.value as CommContactListFilters["source"],
              }));
            }}
          >
            <option value="all">Все</option>
            <option value="SALEBOT_IMPORT">Импорт SaleBot</option>
            <option value="VK_WEBHOOK">VK webhook</option>
            <option value="MANUAL">Вручную</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Тех. статус</span>
          <select
            className={filterClass}
            value={filters.deliveryStatus}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                deliveryStatus: event.target
                  .value as CommContactListFilters["deliveryStatus"],
              }));
            }}
          >
            <option value="all">Все</option>
            <option value="UNKNOWN">Неизвестно</option>
            <option value="ALLOWED">Разрешена</option>
            <option value="DENIED">Запрещена</option>
            <option value="BLOCKED">Заблокирован</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Рекламное согласие</span>
          <select
            className={filterClass}
            value={filters.consentStatus}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                consentStatus: event.target
                  .value as CommContactListFilters["consentStatus"],
              }));
            }}
          >
            <option value="all">Все</option>
            <option value="UNKNOWN">Не подтверждено</option>
            <option value="CONFIRMED">Подтверждено</option>
            <option value="REVOKED">Отозвано</option>
          </select>
          <span className={hintClass}>
            UNKNOWN не допускается к рекламной рассылке.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Отписка</span>
          <select
            className={filterClass}
            value={filters.unsubscribed}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                unsubscribed: event.target
                  .value as CommContactListFilters["unsubscribed"],
              }));
            }}
          >
            <option value="all">Все</option>
            <option value="yes">Отписались</option>
            <option value="no">Не отписались</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Связь с Client</span>
          <select
            className={filterClass}
            value={filters.linkedClient}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                linkedClient: event.target
                  .value as CommContactListFilters["linkedClient"],
              }));
            }}
          >
            <option value="all">Все</option>
            <option value="yes">Есть</option>
            <option value="no">Нет</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Тег</span>
          <input
            className={fieldClass}
            value={filters.tag}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, tag: event.target.value }));
            }}
            placeholder="например cold_plasma_interest"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Последнее взаимодействие с</span>
          <input
            type="date"
            className={fieldClass}
            value={filters.lastInteractionFrom}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                lastInteractionFrom: event.target.value,
              }));
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Последнее взаимодействие по</span>
          <input
            type="date"
            className={fieldClass}
            value={filters.lastInteractionTo}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({
                ...current,
                lastInteractionTo: event.target.value,
              }));
            }}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={showTechIds}
          onChange={(event) => setShowTechIds(event.target.checked)}
        />
        Показать технические ID канала (только для владельца, не для логов)
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-600">
            <tr>
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Канал</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Согласие</th>
              <th className="px-3 py-2">Источник</th>
              <th className="px-3 py-2">Последнее</th>
              <th className="px-3 py-2">Допуск</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id} className="border-b border-zinc-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-900">
                    {contact.displayName || "Без имени"}
                  </div>
                  {showTechIds ? (
                    <div className="font-mono text-xs text-zinc-500">
                      {contact.channelUserId}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">VK</td>
                <td className="px-3 py-2">
                  {COMM_DELIVERY_STATUS_LABELS[contact.deliveryStatus]}
                  {contact.isUnsubscribed ? " · отписка" : ""}
                </td>
                <td className="px-3 py-2">
                  {COMM_CONSENT_STATUS_LABELS[contact.consentStatus]}
                </td>
                <td className="px-3 py-2">
                  {COMM_SOURCE_LABELS[contact.source]}
                </td>
                <td className="px-3 py-2">
                  {formatDate(contact.lastInteractionAt)}
                </td>
                <td className="px-3 py-2">
                  {contact.eligibleForPromo ? "Да" : "Нет"}
                </td>
              </tr>
            ))}
            {!loading && contacts.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-zinc-500" colSpan={7}>
                  Пока нет контактов. Импортируйте выгрузку SaleBot на вкладке
                  «Импорт».
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ListPaginationBar
        shownCount={contacts.length}
        total={total}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        pageSizes={COMM_CONTACT_LIST_PAGE_SIZES}
        loading={loading}
        onPageSizeChange={(size) => {
          setPage(1);
          setPageSize(size);
        }}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />
    </section>
  );
}

function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CommImportPreviewResult | null>(null);
  const [payload, setPayload] = useState<{
    csvText?: string;
    zipBase64?: string;
    originalFileName?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<
    Array<{
      id: string;
      status: string;
      originalFileName: string | null;
      fileKind: string;
      summary: unknown;
      createdAt: string;
      appliedAt: string | null;
    }>
  >([]);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/admin/communications/import/jobs", {
      cache: "no-store",
    });
    const data = await readApiJsonResponse<{ ok: boolean; jobs?: typeof jobs }>(
      response,
    );
    if (data.ok) {
      setJobs(data.jobs ?? []);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  async function prepareFile(selected: File) {
    setError(null);
    setPreview(null);
    setMessage(null);
    const name = selected.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const csvText = await selected.text();
      setPayload({ csvText, originalFileName: selected.name });
      setFile(selected);
      return;
    }
    if (name.endsWith(".zip")) {
      const buffer = await selected.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const zipBase64 = btoa(binary);
      setPayload({ zipBase64, originalFileName: selected.name });
      setFile(selected);
      return;
    }
    setError("Поддерживаются только .csv и .zip");
    setFile(null);
    setPayload(null);
  }

  async function runPreview() {
    if (!payload) {
      setError("Сначала выберите файл");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/communications/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readApiJsonResponse<{
        ok: boolean;
        preview?: CommImportPreviewResult;
        error?: string;
      }>(response);
      if (!data.ok || !data.preview) {
        throw new Error(data.error || "Ошибка предварительного анализа");
      }
      setPreview(data.preview);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка preview");
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!payload || !preview) {
      setError("Сначала выполните предварительный анализ");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/communications/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, jobId: preview.jobId }),
      });
      const data = await readApiJsonResponse<{
        ok: boolean;
        error?: string;
        result?: { created: number; updated: number };
      }>(response);
      if (!data.ok) {
        throw new Error(data.error || "Ошибка импорта");
      }
      setMessage(
        `Импорт применён: создано ${data.result?.created ?? 0}, обновлено ${data.result?.updated ?? 0}. Исходный файл не сохраняется.`,
      );
      setPreview(null);
      setPayload(null);
      setFile(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка commit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Ручной импорт выгрузки SaleBot. Только VK-строки. CRM-клиенты не
        создаются. Телефон и email не сохраняются в аудитории коммуникаций.
      </p>

      <div className="rounded border border-zinc-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Файл CSV или ZIP</span>
          <input
            type="file"
            accept=".csv,.zip,text/csv,application/zip"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) {
                void prepareFile(selected);
              }
            }}
          />
          <span className={hintClass}>
            ZIP может содержать только один ожидаемый CSV. Лимиты размера и строк
            проверяются на сервере.
          </span>
        </label>
        {file ? (
          <p className="mt-2 text-sm text-zinc-700">Выбран: {file.name}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !payload}
            onClick={() => void runPreview()}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            1. Предварительный анализ
          </button>
          <button
            type="button"
            disabled={busy || !preview}
            onClick={() => void runCommit()}
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50"
          >
            2. Подтвердить импорт
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {preview ? (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-zinc-900">
            Результат анализа
          </h3>
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            {[
              ["Всего строк", preview.summary.totalRows],
              ["VK-строк", preview.summary.vkRows],
              ["Уникальных VK ID", preview.summary.validUniqueVkIds],
              ["Новых", preview.summary.newCount],
              ["Обновляемых", preview.summary.updateCount],
              ["Дублей в файле", preview.summary.duplicateInFile],
              ["Заблокированных", preview.summary.blockedCount],
              ["Отписавшихся", preview.summary.unsubscribedCount],
              ["Пропущенных", preview.summary.skippedCount],
              ["Потенциально доступных", preview.summary.potentiallyEligible],
              ["Недоступных для рекламы", preview.summary.ineligibleForPromo],
              ["Suppression сохранён", preview.summary.suppressedPreserved],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded bg-zinc-50 px-3 py-2">
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="font-medium text-zinc-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <div className="rounded border border-zinc-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-zinc-900">Журнал импортов</h3>
        <p className={hintClass}>
          Без исходного файла и без персональных данных в логах.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.id} className="rounded border border-zinc-100 px-3 py-2">
              <div className="font-medium">
                {job.originalFileName || "без имени"} · {job.status} ·{" "}
                {job.fileKind}
              </div>
              <div className="text-xs text-zinc-500">
                {formatDate(job.createdAt)}
                {job.appliedAt ? ` · применён ${formatDate(job.appliedAt)}` : ""}
              </div>
            </li>
          ))}
          {jobs.length === 0 ? (
            <li className="text-zinc-500">Журнал пуст</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}

function SegmentsTab() {
  const [segments, setSegments] = useState<CommSegmentDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/communications/segments", {
          cache: "no-store",
        });
        const data = await readApiJsonResponse<{
          ok: boolean;
          segments?: CommSegmentDto[];
          error?: string;
        }>(response);
        if (!data.ok) {
          throw new Error(data.error || "Ошибка загрузки сегментов");
        }
        setSegments(data.segments ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка");
      }
    })();
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Сегменты хранят определения фильтров, а не копии контактов. Перед будущим
        запуском рассылки сегмент пересчитывается.
      </p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-3">
        {segments.map((segment) => (
          <article
            key={segment.id}
            className="rounded border border-zinc-200 bg-white p-4"
          >
            <h3 className="font-medium text-zinc-900">{segment.name}</h3>
            <p className="mt-1 text-sm text-zinc-600">{segment.description}</p>
            <p className="mt-2 text-xs text-zinc-500">
              Ключ: {segment.key}
              {segment.isSystem ? " · системный" : ""} · оценка аудитории:{" "}
              {segment.estimatedCount ?? "—"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<CommCampaignDto[]>([]);
  const [segments, setSegments] = useState<CommSegmentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<CommCampaignPreview | null>(null);
  const [form, setForm] = useState({
    name: "Холодная плазма — рассказ об акции",
    slug: "cold-plasma-intro",
    segmentId: "",
    messageText:
      "На первую процедуру холодной плазмы действует скидка 30%. Хотите узнать подробности?",
    imageUrl: "",
    attributionWindowHours: 72,
    buttons: DEFAULT_BUTTONS,
  });

  const load = useCallback(async () => {
    const [campaignsRes, segmentsRes] = await Promise.all([
      fetch("/api/admin/communications/campaigns", { cache: "no-store" }),
      fetch("/api/admin/communications/segments", { cache: "no-store" }),
    ]);
    const campaignsData = await readApiJsonResponse<{
      ok: boolean;
      campaigns?: CommCampaignDto[];
      error?: string;
    }>(campaignsRes);
    const segmentsData = await readApiJsonResponse<{
      ok: boolean;
      segments?: CommSegmentDto[];
    }>(segmentsRes);
    if (!campaignsData.ok) {
      throw new Error(campaignsData.error || "Ошибка загрузки рассылок");
    }
    setCampaigns(campaignsData.campaigns ?? []);
    setSegments(segmentsData.segments ?? []);
    if (!form.segmentId && segmentsData.segments?.[0]) {
      setForm((current) => ({
        ...current,
        segmentId: segmentsData.segments![0]!.id,
      }));
    }
  }, [form.segmentId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Ошибка"),
    );
  }, [load]);

  async function createDraft() {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/communications/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readApiJsonResponse<{
        ok: boolean;
        campaign?: CommCampaignDto;
        error?: string;
      }>(response);
      if (!data.ok) {
        throw new Error(data.error || "Не удалось создать черновик");
      }
      setMessage("Черновик создан. Отправка недоступна до подключения VK.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function markReady(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/admin/communications/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY" }),
      });
      const data = await readApiJsonResponse<{ ok: boolean; error?: string }>(
        response,
      );
      if (!data.ok) {
        throw new Error(data.error || "Не удалось перевести в READY");
      }
      setMessage("Статус READY. SCHEDULED/RUNNING по-прежнему заблокированы.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function showPreview(id: string) {
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/communications/campaigns/${id}?preview=1`,
        { cache: "no-store" },
      );
      const data = await readApiJsonResponse<{
        ok: boolean;
        preview?: CommCampaignPreview;
        error?: string;
      }>(response);
      if (!data.ok || !data.preview) {
        throw new Error(data.error || "Ошибка предпросмотра");
      }
      setPreview(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  const buttonEditor = useMemo(
    () =>
      form.buttons.map((button, index) => (
        <div
          key={`${button.buttonKey}-${index}`}
          className="grid gap-2 rounded border border-zinc-100 p-3 md:grid-cols-2"
        >
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Текст</span>
            <input
              className={fieldClass}
              value={button.text}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => {
                  const buttons = [...current.buttons];
                  buttons[index] = { ...buttons[index]!, text: value };
                  return { ...current, buttons };
                });
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Тип</span>
            <select
              className={filterClass}
              value={button.type}
              onChange={(event) => {
                const value = event.target.value as CommCampaignButtonInput["type"];
                setForm((current) => {
                  const buttons = [...current.buttons];
                  buttons[index] = { ...buttons[index]!, type: value };
                  return { ...current, buttons };
                });
              }}
            >
              {Object.entries(COMM_BUTTON_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>buttonKey</span>
            <input
              className={fieldClass}
              value={button.buttonKey}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => {
                  const buttons = [...current.buttons];
                  buttons[index] = { ...buttons[index]!, buttonKey: value };
                  return { ...current, buttons };
                });
              }}
            />
            <span className={hintClass}>Стабильный ключ для UTM и аналитики.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Стиль VK</span>
            <select
              className={filterClass}
              value={button.style ?? "SECONDARY"}
              onChange={(event) => {
                const value = event.target
                  .value as CommCampaignButtonInput["style"];
                setForm((current) => {
                  const buttons = [...current.buttons];
                  buttons[index] = { ...buttons[index]!, style: value };
                  return { ...current, buttons };
                });
              }}
            >
              {Object.entries(COMM_BUTTON_STYLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className={hintClass}>
              Произвольные фирменные цвета недоступны — только стили VK.
            </span>
          </label>
          {button.type === "OPEN_LINK" ? (
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Ссылка</span>
              <input
                className={fieldClass}
                value={button.url ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((current) => {
                    const buttons = [...current.buttons];
                    buttons[index] = { ...buttons[index]!, url: value };
                    return { ...current, buttons };
                  });
                }}
              />
              <span className={hintClass}>{COMM_CTA_LINK_HINT}</span>
            </label>
          ) : null}
        </div>
      )),
    [form.buttons],
  );

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Разрешены только черновики и подготовка READY. Запуск и планирование
        блокируются, пока VK не подключён. Рассылка только рассказывает об акции —
        правило скидки 30% не изменяется.
      </p>

      <div className="rounded border border-zinc-200 bg-white p-4">
        <h3 className="text-sm font-semibold">Новый черновик</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Название</span>
            <input
              className={fieldClass}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Slug кампании</span>
            <input
              className={fieldClass}
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
            <span className={hintClass}>
              Используется в utm_campaign. Без VK ID и телефонов.
            </span>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Сегмент</span>
            <select
              className={filterClass}
              value={form.segmentId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  segmentId: event.target.value,
                }))
              }
            >
              <option value="">Не выбран</option>
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Текст сообщения</span>
            <textarea
              className={fieldClass}
              rows={4}
              value={form.messageText}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  messageText: event.target.value,
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Изображение (заготовка URL)</span>
            <input
              className={fieldClass}
              value={form.imageUrl}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  imageUrl: event.target.value,
                }))
              }
              placeholder="https://… или пусто"
            />
            <span className={hintClass}>
              Только безопасная заготовка. Отправка изображения не выполняется.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Окно атрибуции (часы)</span>
            <input
              type="number"
              min={1}
              max={720}
              className={fieldClass}
              value={form.attributionWindowHours}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  attributionWindowHours: Number(event.target.value) || 72,
                }))
              }
            />
            <span className={hintClass}>
              Для будущей связи ответов и конверсий с кампанией.
            </span>
          </label>
        </div>

        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium">Кнопки</h4>
          {buttonEditor}
        </div>

        <button
          type="button"
          onClick={() => void createDraft()}
          className="mt-4 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          Создать черновик
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {preview ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="text-sm font-semibold">Предпросмотр</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">{preview.messageText}</p>
          <ul className="mt-3 space-y-1 text-sm">
            {preview.buttons.map((button) => (
              <li key={button.buttonKey}>
                [{button.style}] {button.text} —{" "}
                {COMM_BUTTON_TYPE_LABELS[button.type]}
                {button.url ? ` → ${button.url}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-600">
            Оценка аудитории: {preview.audienceEstimate}. {preview.connectorMessage}
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        {campaigns.map((campaign) => (
          <article
            key={campaign.id}
            className="rounded border border-zinc-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-zinc-900">{campaign.name}</h3>
                <p className="text-xs text-zinc-500">
                  {campaign.slug} · {COMM_CAMPAIGN_STATUS_LABELS[campaign.status]} ·
                  сегмент: {campaign.segmentName || "—"} · оценка:{" "}
                  {campaign.audienceEstimate ?? "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 text-xs"
                  onClick={() => void showPreview(campaign.id)}
                >
                  Предпросмотр
                </button>
                {campaign.status === "DRAFT" ? (
                  <button
                    type="button"
                    className="rounded border border-zinc-300 px-2 py-1 text-xs"
                    onClick={() => void markReady(campaign.id)}
                  >
                    В READY
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-zinc-700">
              {campaign.messageText || "Текст пока пуст"}
            </p>
          </article>
        ))}
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">Черновиков пока нет.</p>
        ) : null}
      </div>
    </section>
  );
}

function StatsTab() {
  const [summary, setSummary] = useState<CommAnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/communications/analytics", {
          cache: "no-store",
        });
        const data = await readApiJsonResponse<{
          ok: boolean;
          summary?: CommAnalyticsSummary;
          error?: string;
        }>(response);
        if (!data.ok || !data.summary) {
          throw new Error(data.error || "Ошибка статистики");
        }
        setSummary(data.summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка");
      }
    })();
  }, []);

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (!summary) {
    return <p className="text-sm text-zinc-500">Загрузка статистики…</p>;
  }

  const cards: Array<[string, number, number]> = [
    ["Импортирован", summary.imported.total, summary.imported.uniqueContacts],
    ["Исключён", summary.excluded.total, summary.excluded.uniqueContacts],
    ["Поставлен в очередь", summary.queued.total, summary.queued.uniqueContacts],
    [
      summary.acceptedByChannel.label,
      summary.acceptedByChannel.total,
      summary.acceptedByChannel.uniqueContacts,
    ],
    ["Ошибка отправки", summary.sendError.total, summary.sendError.uniqueContacts],
    [
      summary.readConfirmed.label,
      summary.readConfirmed.total,
      summary.readConfirmed.uniqueContacts,
    ],
    ["Нажали кнопку", summary.buttonClicked.total, summary.buttonClicked.uniqueContacts],
    ["Перешли по ссылке", summary.linkOpened.total, summary.linkOpened.uniqueContacts],
    ["Ответили", summary.replied.total, summary.replied.uniqueContacts],
    ["Отписка", summary.unsubscribed.total, summary.unsubscribed.uniqueContacts],
    ["Оставили заявку", summary.leadCreated.total, summary.leadCreated.uniqueContacts],
    [
      "Записались",
      summary.appointmentCreated.total,
      summary.appointmentCreated.uniqueContacts,
    ],
  ];

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">{summary.note}</p>
      <p className="text-xs text-zinc-500">
        {summary.readNotConfirmedLabel} — честная формулировка вместо «Не
        прочитано».
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map(([label, total, unique]) => (
          <div
            key={label}
            className="rounded border border-zinc-200 bg-white px-3 py-3"
          >
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{total}</div>
            <div className="text-xs text-zinc-500">уникальных контактов: {unique}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
