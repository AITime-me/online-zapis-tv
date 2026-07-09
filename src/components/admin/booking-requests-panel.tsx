"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookingRequestStatus } from "@prisma/client";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { getStudioNow, normalizeDate } from "@/lib/datetime/date-layer";
import { ClientTagsInlineEditor } from "@/components/admin/client-tags-inline-editor";
import {
  getBookingRequestClientLinkLabel,
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
  type BookingRequestDto,
} from "@/services/BookingRequestService";

const STATUS_OPTIONS: BookingRequestStatus[] = ["NEW", "CONTACTED", "CLOSED"];

type StatusFilter = "ACTIVE" | "NEW" | "CONTACTED" | "CLOSED" | "ALL";

type RequestFilters = {
  phone: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  status: StatusFilter;
};

const DEFAULT_FILTERS: RequestFilters = {
  phone: "",
  name: "",
  dateFrom: "",
  dateTo: "",
  status: "ACTIVE",
};

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ACTIVE", label: "Все активные" },
  { value: "NEW", label: "Новая" },
  { value: "CONTACTED", label: "Связались" },
  { value: "CLOSED", label: "Закрыта" },
  { value: "ALL", label: "Все" },
];

const PREVIEW_LINE_COUNT = 3;
const AUTO_REFRESH_INTERVAL_MS = 15_000;

function formatLastUpdated(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(normalizeDate(value) ?? getStudioNow());
}

function toStudioDateKey(value: string): string | null {
  const date = normalizeDate(value);
  if (!date) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function matchesRequestFilters(
  request: BookingRequestDto,
  filters: RequestFilters,
): boolean {
  const phoneQuery = filters.phone.trim();
  if (phoneQuery && !request.clientPhone.includes(phoneQuery)) {
    return false;
  }

  const nameQuery = filters.name.trim().toLowerCase();
  if (nameQuery && !request.clientName.toLowerCase().includes(nameQuery)) {
    return false;
  }

  const createdKey = toStudioDateKey(request.createdAt);
  if (filters.dateFrom && createdKey && createdKey < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo && createdKey && createdKey > filters.dateTo) {
    return false;
  }

  return true;
}

function matchesStatusFilter(
  request: BookingRequestDto,
  statusFilter: StatusFilter,
  section: "active" | "closed",
): boolean {
  if (statusFilter === "CLOSED") {
    return section === "closed" && request.status === "CLOSED";
  }

  if (statusFilter === "NEW") {
    return section === "active" && request.status === "NEW";
  }

  if (statusFilter === "CONTACTED") {
    return section === "active" && request.status === "CONTACTED";
  }

  if (statusFilter === "ACTIVE") {
    if (section === "active") {
      return request.status === "NEW" || request.status === "CONTACTED";
    }
    return request.status === "CLOSED";
  }

  // ALL
  if (section === "active") {
    return request.status === "NEW" || request.status === "CONTACTED";
  }
  return request.status === "CLOSED";
}

function hasNonDefaultFilters(filters: RequestFilters): boolean {
  return (
    filters.phone.trim().length > 0 ||
    filters.name.trim().length > 0 ||
    filters.dateFrom.length > 0 ||
    filters.dateTo.length > 0 ||
    filters.status !== "ACTIVE"
  );
}

function ClientLinkBadge({
  request,
}: {
  request: BookingRequestDto;
}) {
  const label = getBookingRequestClientLinkLabel(request.clientLinkStatus);
  const tone =
    request.clientLinkStatus === "linked"
      ? "bg-emerald-50 text-emerald-800"
      : request.clientLinkStatus === "new"
        ? "bg-sky-50 text-sky-800"
        : request.clientLinkStatus === "duplicate"
          ? "bg-amber-50 text-amber-900"
          : "bg-zinc-100 text-zinc-600";

  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function ClientLinkCell({
  request,
  onClientTagsChange,
  onTagInteractionChange,
}: {
  request: BookingRequestDto;
  onClientTagsChange: (clientId: string, tags: string[]) => void;
  onTagInteractionChange?: (busy: boolean) => void;
}) {
  const client = request.client;

  return (
    <div className="space-y-1">
      <ClientLinkBadge request={request} />
      {client && request.clientId ? (
        <div className="space-y-1 text-xs text-zinc-600">
          <div className="font-medium text-zinc-800">{client.fullName}</div>
          {client.phone ? <div>{client.phone}</div> : null}
          {client.email ? <div>{client.email}</div> : null}
          <ClientTagsInlineEditor
            clientId={request.clientId}
            tags={client.tags}
            onTagsChange={(tags) => onClientTagsChange(request.clientId!, tags)}
            onInteractionChange={onTagInteractionChange}
            compact
          />
          <Link
            href={`/admin/clients?q=${encodeURIComponent(client.phone ?? client.fullName)}`}
            className="inline-block font-medium text-[#1a73e8] hover:underline"
          >
            Открыть клиента
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function CommentCell({ comment }: { comment: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = comment?.trim() || "—";

  if (text === "—") {
    return <span className="text-zinc-400">—</span>;
  }

  const lines = text.split("\n");
  const isLong = lines.length > PREVIEW_LINE_COUNT || text.length > 220;

  if (!isLong) {
    return (
      <div className="max-w-[16rem] whitespace-pre-line break-words text-sm sm:max-w-xs">
        {text}
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="max-w-[16rem] sm:max-w-xs">
        <div className="max-h-64 overflow-y-auto whitespace-pre-line break-words text-sm">
          {text}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs font-medium text-[#1a73e8] hover:underline"
        >
          Свернуть
        </button>
      </div>
    );
  }

  const preview = lines.slice(0, PREVIEW_LINE_COUNT).join("\n");

  return (
    <div className="max-w-[16rem] sm:max-w-xs">
      <div className="line-clamp-3 whitespace-pre-line break-words text-sm">
        {preview}
        {lines.length > PREVIEW_LINE_COUNT ? "…" : ""}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 text-xs font-medium text-[#1a73e8] hover:underline"
      >
        Подробнее
      </button>
    </div>
  );
}

function RequestTable({
  requests,
  updatingId,
  onStatusChange,
  onClientTagsChange,
  onTagInteractionChange,
}: {
  requests: BookingRequestDto[];
  updatingId: string | null;
  onStatusChange: (id: string, status: BookingRequestStatus) => void;
  onClientTagsChange: (clientId: string, tags: string[]) => void;
  onTagInteractionChange?: (busy: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded border border-[#dadce0] bg-white">
      <table className="min-w-[720px] w-full text-sm">
        <thead className="border-b border-[#dadce0] bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">Дата</th>
            <th className="px-3 py-2 font-medium">Имя</th>
            <th className="px-3 py-2 font-medium">Телефон</th>
            <th className="px-3 py-2 font-medium">Мастер</th>
            <th className="px-3 py-2 font-medium">Тип</th>
            <th className="px-3 py-2 font-medium">Клиент CRM</th>
            <th className="px-3 py-2 font-medium">Комментарий</th>
            <th className="px-3 py-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#dadce0]">
          {requests.map((request) => (
            <tr key={request.id} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap">
                {formatCreatedAt(request.createdAt)}
              </td>
              <td className="px-3 py-2 break-words">{request.clientName}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {request.clientPhone}
              </td>
              <td className="px-3 py-2 break-words">
                {request.masterName ?? "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {getBookingRequestTypeLabel(request.type)}
              </td>
              <td className="px-3 py-2">
                <ClientLinkCell
                  request={request}
                  onClientTagsChange={onClientTagsChange}
                  onTagInteractionChange={onTagInteractionChange}
                />
              </td>
              <td className="px-3 py-2">
                <CommentCell comment={request.comment} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <select
                  value={request.status}
                  disabled={updatingId === request.id}
                  onChange={(event) =>
                    onStatusChange(
                      request.id,
                      event.target.value as BookingRequestStatus,
                    )
                  }
                  className="max-w-full rounded border border-zinc-300 px-2 py-1 text-xs"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {getBookingRequestStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
      {message}
    </div>
  );
}

export function BookingRequestsPanel({
  initialRequests,
}: {
  initialRequests: BookingRequestDto[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filters, setFilters] = useState<RequestFilters>(DEFAULT_FILTERS);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date());
  const [isFetching, setIsFetching] = useState(false);

  const refreshInFlightRef = useRef(false);
  const updatingIdRef = useRef<string | null>(null);
  const tagInteractionCountRef = useRef(0);

  useEffect(() => {
    updatingIdRef.current = updatingId;
  }, [updatingId]);

  const handleTagInteractionChange = useCallback((busy: boolean) => {
    tagInteractionCountRef.current = Math.max(
      0,
      tagInteractionCountRef.current + (busy ? 1 : -1),
    );
  }, []);

  const isAutoRefreshPaused = useCallback(() => {
    return (
      updatingIdRef.current !== null || tagInteractionCountRef.current > 0
    );
  }, []);

  useEffect(() => {
    setRequests(initialRequests);
    setLastUpdatedAt(new Date());
  }, [initialRequests]);

  const refreshRequests = useCallback(async (options?: { manual?: boolean }) => {
    if (refreshInFlightRef.current) {
      return;
    }

    if (!options?.manual && isAutoRefreshPaused()) {
      return;
    }

    refreshInFlightRef.current = true;
    if (options?.manual) {
      setRefreshing(true);
    }
    setIsFetching(true);

    try {
      const response = await fetch("/api/booking/requests", {
        cache: "no-store",
      });
      const data = await readApiJsonResponse<{
        ok?: boolean;
        requests?: BookingRequestDto[];
        error?: string;
      }>(response);

      if (!response.ok || !data.ok || !data.requests) {
        throw new Error(data.error ?? "Не удалось обновить заявки");
      }

      setRequests(data.requests);
      setLastUpdatedAt(new Date());
      setRefreshError(null);
    } catch {
      setRefreshError("Не удалось обновить заявки. Попробуйте ещё раз.");
    } finally {
      refreshInFlightRef.current = false;
      setIsFetching(false);
      if (options?.manual) {
        setRefreshing(false);
      }
    }
  }, [isAutoRefreshPaused]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshRequests();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshRequests]);

  useEffect(() => {
    if (filters.status === "CLOSED") {
      setClosedExpanded(true);
    }
  }, [filters.status]);

  const updateStatus = useCallback(
    async (id: string, status: BookingRequestStatus) => {
      setUpdatingId(id);
      setError(null);
      try {
        const response = await fetch("/api/booking/requests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const data = await readApiJsonResponse<{
          ok?: boolean;
          request?: BookingRequestDto;
          error?: string;
        }>(response);
        if (!response.ok || !data.ok || !data.request) {
          throw new Error(data.error ?? "Не удалось обновить статус");
        }
        setRequests((current) =>
          current.map((entry) =>
            entry.id === id ? data.request! : entry,
          ),
        );
        setLastUpdatedAt(new Date());
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Не удалось обновить статус",
        );
      } finally {
        setUpdatingId(null);
      }
    },
    [],
  );

  const handleClientTagsChange = useCallback((clientId: string, tags: string[]) => {
    setRequests((current) =>
      current.map((request) =>
        request.client?.id === clientId
          ? {
              ...request,
              client: request.client ? { ...request.client, tags } : null,
            }
          : request,
      ),
    );
  }, []);

  const filteredByFields = useMemo(
    () => requests.filter((request) => matchesRequestFilters(request, filters)),
    [requests, filters],
  );

  const activeRequests = useMemo(
    () =>
      filteredByFields.filter((request) =>
        matchesStatusFilter(request, filters.status, "active"),
      ),
    [filteredByFields, filters.status],
  );

  const closedRequests = useMemo(
    () =>
      filteredByFields.filter((request) =>
        matchesStatusFilter(request, filters.status, "closed"),
      ),
    [filteredByFields, filters.status],
  );

  const closedArchiveCount = useMemo(
    () =>
      filteredByFields.filter((request) => request.status === "CLOSED").length,
    [filteredByFields],
  );

  const filtersApplied = hasNonDefaultFilters(filters);
  const showActiveSection = filters.status !== "CLOSED";
  const showClosedSection =
    filters.status === "CLOSED" ||
    filters.status === "ACTIVE" ||
    filters.status === "ALL";

  const activeEmptyMessage = filtersApplied
    ? "По выбранным фильтрам заявок не найдено."
    : "Активных заявок пока нет.";

  const closedEmptyMessage = filtersApplied
    ? "По выбранным фильтрам заявок не найдено."
    : "Закрытых заявок пока нет.";

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setClosedExpanded(false);
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {refreshError ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {refreshError}
        </div>
      ) : null}

      <section className="rounded border border-[#dadce0] bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Телефон</span>
            <input
              type="text"
              value={filters.phone}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  phone: event.target.value,
                }))
              }
              placeholder="Телефон"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Имя</span>
            <input
              type="text"
              value={filters.name}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Имя"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Дата от</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }))
              }
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Дата до</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }))
              }
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Статус</span>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as StatusFilter,
                }))
              }
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshRequests({ manual: true })}
              disabled={refreshing || isFetching}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {refreshing ? "Обновляем..." : "Обновить"}
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Сбросить фильтры
            </button>
          </div>
          <span className="text-xs text-zinc-500">
            Последнее обновление: {formatLastUpdated(lastUpdatedAt)}
            {isFetching && !refreshing ? " · обновляем…" : null}
          </span>
        </div>
      </section>

      {showActiveSection ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-800">
            Активные заявки
            {activeRequests.length > 0 ? ` (${activeRequests.length})` : ""}
          </h2>
          {activeRequests.length > 0 ? (
            <RequestTable
              requests={activeRequests}
              updatingId={updatingId}
              onStatusChange={(id, status) => void updateStatus(id, status)}
              onClientTagsChange={handleClientTagsChange}
              onTagInteractionChange={handleTagInteractionChange}
            />
          ) : (
            <EmptyState message={activeEmptyMessage} />
          )}
        </section>
      ) : null}

      {showClosedSection ? (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setClosedExpanded((current) => !current)}
            className="flex w-full items-center justify-between rounded border border-[#dadce0] bg-zinc-50 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
          >
            <span>
              Закрытые заявки ({closedArchiveCount})
            </span>
            <span aria-hidden="true">{closedExpanded ? "▲" : "▼"}</span>
          </button>

          {closedExpanded ? (
            closedRequests.length > 0 ? (
              <RequestTable
                requests={closedRequests}
                updatingId={updatingId}
                onStatusChange={(id, status) => void updateStatus(id, status)}
                onClientTagsChange={handleClientTagsChange}
                onTagInteractionChange={handleTagInteractionChange}
              />
            ) : (
              <EmptyState message={closedEmptyMessage} />
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
