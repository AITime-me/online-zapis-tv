"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClientDuplicateReviewStatus } from "@prisma/client";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { getClientStatusLabel } from "@/lib/clients/defaults";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import { ClientMergeModal } from "@/components/admin/client-merge-modal";
import type {
  ClientDuplicateGroupDto,
  ClientDuplicateSummaryDto,
  DuplicateConfidence,
} from "@/types/client-duplicates";
import {
  DUPLICATE_CONFIDENCE_LABELS,
  DUPLICATE_REASON_LABELS,
  DUPLICATE_REVIEW_STATUS_LABELS,
} from "@/types/client-duplicates";

type ConfidenceFilter = DuplicateConfidence | "all";
type ReviewStatusFilter = ClientDuplicateReviewStatus | "all";

type DuplicatesResponse = {
  ok: boolean;
  summary?: ClientDuplicateSummaryDto;
  groups?: ClientDuplicateGroupDto[];
  error?: string;
};

const CONFIDENCE_CLASS: Record<DuplicateConfidence, string> = {
  HIGH: "bg-red-50 text-red-800",
  MEDIUM: "bg-amber-50 text-amber-900",
  LOW: "bg-zinc-100 text-zinc-700",
};

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

export function ClientDuplicatesPanel() {
  const [summary, setSummary] = useState<ClientDuplicateSummaryDto | null>(null);
  const [groups, setGroups] = useState<ClientDuplicateGroupDto[]>([]);
  const [confidenceFilter, setConfidenceFilter] =
    useState<ConfidenceFilter>("all");
  const [reviewStatusFilter, setReviewStatusFilter] =
    useState<ReviewStatusFilter>("REVIEW");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingFingerprint, setUpdatingFingerprint] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [mergeClientIds, setMergeClientIds] = useState<string[] | null>(null);

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (confidenceFilter !== "all") {
        params.set("confidence", confidenceFilter);
      }
      if (reviewStatusFilter !== "all") {
        params.set("reviewStatus", reviewStatusFilter);
      }
      const query = search.trim();
      if (query) {
        params.set("q", query);
      }

      const response = await fetch(
        `/api/admin/clients/duplicates?${params.toString()}`,
        { cache: "no-store" },
      );
      const payload = await readApiJsonResponse<DuplicatesResponse>(response);

      if (!response.ok || !payload.ok || !payload.summary || !payload.groups) {
        throw new Error(payload.error ?? "Не удалось загрузить возможные дубли");
      }

      setSummary(payload.summary);
      setGroups(payload.groups);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить возможные дубли",
      );
    } finally {
      setLoading(false);
    }
  }, [confidenceFilter, reviewStatusFilter, search]);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  const updateReviewStatus = async (
    fingerprint: string,
    status: ClientDuplicateReviewStatus,
  ) => {
    setUpdatingFingerprint(fingerprint);
    setError(null);

    try {
      const response = await fetch("/api/admin/clients/duplicates/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, status }),
      });
      const payload = await readApiJsonResponse<{ ok: boolean; error?: string }>(
        response,
      );

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Не удалось сохранить статус разбора");
      }

      await loadDuplicates();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Не удалось сохранить статус разбора",
      );
    } finally {
      setUpdatingFingerprint(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/clients"
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            ← К клиентам
          </Link>
          <button
            type="button"
            onClick={() => void loadDuplicates()}
            disabled={loading}
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          >
            {loading ? "Обновление…" : "Обновить"}
          </button>
        </div>
      </div>

      {resultMessage ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {resultMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {summary ? (
        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SummaryCard label="Всего групп" value={summary.totalGroups} />
          <SummaryCard label="Высокая уверенность" value={summary.highConfidence} />
          <SummaryCard label="Средняя уверенность" value={summary.mediumConfidence} />
          <SummaryCard label="Низкая уверенность" value={summary.lowConfidence} />
          <SummaryCard label="Требует проверки" value={summary.needsReview} />
          <SummaryCard label="Отложено" value={summary.postponed} />
          <SummaryCard label="Не дубли" value={summary.notDuplicate} />
        </section>
      ) : null}

      <section className="grid gap-3 rounded border border-zinc-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_12rem_14rem_auto] md:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-700">Поиск</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Имя, телефон, email"
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-700">Уверенность</span>
          <select
            value={confidenceFilter}
            onChange={(event) =>
              setConfidenceFilter(event.target.value as ConfidenceFilter)
            }
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          >
            <option value="all">Все уровни</option>
            <option value="HIGH">Высокая</option>
            <option value="MEDIUM">Средняя</option>
            <option value="LOW">Низкая</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-700">Статус разбора</span>
          <select
            value={reviewStatusFilter}
            onChange={(event) =>
              setReviewStatusFilter(event.target.value as ReviewStatusFilter)
            }
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
          >
            <option value="REVIEW">Требует проверки</option>
            <option value="POSTPONED">Отложено</option>
            <option value="NOT_DUPLICATE">Не дубль</option>
            <option value="all">Все статусы</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setConfidenceFilter("all");
            setReviewStatusFilter("REVIEW");
          }}
          className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          Сбросить
        </button>
      </section>

      {loading ? (
        <div className="rounded border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-600">
          Загрузка возможных дублей…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-600">
          Возможные дубли не найдены.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <DuplicateGroupCard
              key={group.fingerprint}
              group={group}
              updating={updatingFingerprint === group.fingerprint}
              onPostpone={() => void updateReviewStatus(group.fingerprint, "POSTPONED")}
              onNotDuplicate={() =>
                void updateReviewStatus(group.fingerprint, "NOT_DUPLICATE")
              }
              onReturnToReview={() =>
                void updateReviewStatus(group.fingerprint, "REVIEW")
              }
              onMerge={() =>
                setMergeClientIds(group.clients.map((client) => client.id))
              }
            />
          ))}
        </div>
      )}
      {mergeClientIds ? (
        <ClientMergeModal
          clientIds={mergeClientIds}
          onClose={() => setMergeClientIds(null)}
          onMerged={() => {
            setMergeClientIds(null);
            setResultMessage("Клиенты объединены");
            void loadDuplicates();
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function DuplicateGroupCard({
  group,
  updating,
  onPostpone,
  onNotDuplicate,
  onReturnToReview,
  onMerge,
}: {
  group: ClientDuplicateGroupDto;
  updating: boolean;
  onPostpone: () => void;
  onNotDuplicate: () => void;
  onReturnToReview: () => void;
  onMerge: () => void;
}) {
  return (
    <article className="rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${CONFIDENCE_CLASS[group.confidence]}`}
            >
              {DUPLICATE_CONFIDENCE_LABELS[group.confidence]}
            </span>
            <span className="inline-flex rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
              {DUPLICATE_REVIEW_STATUS_LABELS[group.reviewStatus]}
            </span>
            <span className="text-xs text-zinc-500">
              Группа {group.fingerprint.slice(0, 8)}…
            </span>
          </div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {group.reasons.map((reason) => (
              <li key={reason}>• {DUPLICATE_REASON_LABELS[reason]}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          {group.reviewStatus !== "POSTPONED" ? (
            <button
              type="button"
              onClick={onPostpone}
              disabled={updating}
              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              Отложить
            </button>
          ) : null}
          {group.reviewStatus !== "NOT_DUPLICATE" ? (
            <button
              type="button"
              onClick={onNotDuplicate}
              disabled={updating}
              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              Не дубль
            </button>
          ) : null}
          {group.reviewStatus !== "REVIEW" ? (
            <button
              type="button"
              onClick={onReturnToReview}
              disabled={updating}
              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              Вернуть в проверку
            </button>
          ) : null}
          {group.reviewStatus === "REVIEW" || group.reviewStatus === "POSTPONED" ? (
            <button
              type="button"
              onClick={onMerge}
              disabled={updating || group.clients.length < 2}
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              Объединить
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {group.clients.map((client) => (
          <div
            key={client.id}
            className="rounded border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/clients/${client.id}`}
                className="font-medium text-[#1a73e8] hover:underline"
              >
                {client.fullName}
              </Link>
              <Link
                href={`/admin/clients/${client.id}`}
                className="text-xs font-medium text-zinc-600 hover:underline"
              >
                Открыть
              </Link>
              {client.isArchived ? (
                <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">
                  Архив
                </span>
              ) : (
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  Активный
                </span>
              )}
              <span className="text-xs text-zinc-500">
                {getClientStatusLabel(client.status)}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-zinc-600 sm:grid-cols-2 lg:grid-cols-3">
              <p>Телефон: {client.phone ?? "—"}</p>
              <p>Норм. телефон: {client.normalizedPhone ?? "—"}</p>
              <p>Email: {client.email ?? "—"}</p>
              <p>Источник: {client.source ?? "—"}</p>
              <p>Заявок: {client.bookingRequestCount}</p>
              <p>Последний контакт: {formatDateTime(client.lastContactAt)}</p>
              <p>Создан: {formatDateTime(client.createdAt)}</p>
            </div>
            {client.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {client.tags.map((tag) => (
                  <ClientTagBadge key={`${client.id}-${tag}`} tag={tag} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}
