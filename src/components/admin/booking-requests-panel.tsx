"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingRequestStatus } from "@prisma/client";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { getStudioNow, normalizeDate } from "@/lib/datetime/date-layer";
import {
  BOOKING_REQUEST_LIST_PAGE_SIZES,
  BOOKING_REQUEST_STATUS_FILTER_OPTIONS,
  DEFAULT_BOOKING_REQUEST_FILTERS,
  DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
  buildBookingRequestsListUrl,
  hasNonDefaultBookingRequestFilters,
  type BookingRequestListFilters,
} from "@/lib/booking-requests/list-contract";
import {
  getBookingRequestClientLinkLabel,
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
  type BookingRequestDto,
  type BookingRequestListApiPayload,
} from "@/lib/booking-requests/booking-request-contract";
import { ClientTagsInlineEditor } from "@/components/admin/client-tags-inline-editor";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import { ListPaginationBar } from "@/components/admin/list-pagination-bar";

const STATUS_OPTIONS: BookingRequestStatus[] = ["NEW", "CONTACTED", "CLOSED"];

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

function patchRequestInList(
  requests: BookingRequestDto[],
  updated: BookingRequestDto,
): BookingRequestDto[] {
  return requests.map((entry) => (entry.id === updated.id ? updated : entry));
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
        : request.clientLinkStatus === "duplicate" ||
            request.clientLinkStatus === "name_duplicate"
          ? "bg-amber-50 text-amber-900"
          : "bg-zinc-100 text-zinc-600";
  const title =
    request.clientLinkStatus === "none"
      ? "У заявки есть контактные данные, но она пока не связана с карточкой клиента"
      : undefined;

  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${tone}`}
      title={title}
    >
      {label}
    </span>
  );
}

function PossibleDuplicateCandidates({
  request,
  acting,
  onLinkClient,
  onCreateSeparateClient,
}: {
  request: BookingRequestDto;
  acting: boolean;
  onLinkClient: (clientId: string) => void;
  onCreateSeparateClient: () => void;
}) {
  if (!request.hasPossibleClientDuplicates) {
    return null;
  }

  return (
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50/60 p-2">
      <p className="text-xs text-amber-900">
        {request.duplicateReason ?? "Найдены возможные совпадения"}
      </p>
      <div className="space-y-2">
        {request.possibleDuplicateClients.map((candidate) => (
          <div
            key={candidate.id}
            className="rounded border border-amber-100 bg-white p-2 text-xs text-zinc-700"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-900">
                {candidate.fullName}
              </span>
              {candidate.isArchived ? (
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px]">
                  Архив
                </span>
              ) : null}
            </div>
            {candidate.phone ? <div>{candidate.phone}</div> : null}
            {candidate.email ? <div>{candidate.email}</div> : null}
            {candidate.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {candidate.tags.map((tag) => (
                  <ClientTagBadge key={`${candidate.id}-${tag}`} tag={tag} compact />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              disabled={acting}
              onClick={() => onLinkClient(candidate.id)}
              className="mt-2 rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              Связать
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={acting}
        onClick={onCreateSeparateClient}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        Создать отдельного клиента
      </button>
    </div>
  );
}

function ClientLinkCell({
  request,
  acting,
  onLinkClient,
  onCreateSeparateClient,
  onClientTagsChange,
  onTagInteractionChange,
}: {
  request: BookingRequestDto;
  acting: boolean;
  onLinkClient: (clientId: string) => void;
  onCreateSeparateClient: () => void;
  onClientTagsChange: (clientId: string, tags: string[]) => void;
  onTagInteractionChange?: (busy: boolean) => void;
}) {
  const client = request.client;

  return (
    <div className="space-y-1">
      <ClientLinkBadge request={request} />
      {request.hasPossibleClientDuplicates ? (
        <PossibleDuplicateCandidates
          request={request}
          acting={acting}
          onLinkClient={onLinkClient}
          onCreateSeparateClient={onCreateSeparateClient}
        />
      ) : null}
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
            href={`/admin/clients/${request.clientId}`}
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
  clientActionId,
  onStatusChange,
  onLinkClient,
  onCreateSeparateClient,
  onClientTagsChange,
  onTagInteractionChange,
}: {
  requests: BookingRequestDto[];
  updatingId: string | null;
  clientActionId: string | null;
  onStatusChange: (id: string, status: BookingRequestStatus) => void;
  onLinkClient: (requestId: string, clientId: string) => void;
  onCreateSeparateClient: (requestId: string) => void;
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
                  acting={clientActionId === request.id}
                  onLinkClient={(clientId) => onLinkClient(request.id, clientId)}
                  onCreateSeparateClient={() => onCreateSeparateClient(request.id)}
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
  initialActiveRequests,
  initialActiveTotal,
  initialActivePage = 1,
  initialActivePageSize = DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
  initialClosedTotal = 0,
}: {
  initialActiveRequests: BookingRequestDto[];
  initialActiveTotal: number;
  initialActivePage?: number;
  initialActivePageSize?: number;
  initialClosedTotal?: number;
}) {
  const [activeRequests, setActiveRequests] = useState(initialActiveRequests);
  const [activeTotal, setActiveTotal] = useState(initialActiveTotal);
  const [activePage, setActivePage] = useState(initialActivePage);
  const [activePageSize, setActivePageSize] = useState(initialActivePageSize);
  const [activeLoading, setActiveLoading] = useState(false);

  const [closedRequests, setClosedRequests] = useState<BookingRequestDto[]>([]);
  const [closedTotal, setClosedTotal] = useState(initialClosedTotal);
  const [closedPage, setClosedPage] = useState(1);
  const [closedPageSize, setClosedPageSize] = useState(
    DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
  );
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedLoaded, setClosedLoaded] = useState(false);

  const [filters, setFilters] = useState<BookingRequestListFilters>(DEFAULT_BOOKING_REQUEST_FILTERS);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [clientActionId, setClientActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date());
  const [isFetching, setIsFetching] = useState(false);

  const refreshInFlightRef = useRef(false);
  const updatingIdRef = useRef<string | null>(null);
  const tagInteractionCountRef = useRef(0);
  const filtersRef = useRef(filters);
  const activePageRef = useRef(activePage);
  const activePageSizeRef = useRef(activePageSize);
  const closedPageRef = useRef(closedPage);
  const closedPageSizeRef = useRef(closedPageSize);
  const closedExpandedRef = useRef(closedExpanded);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  useEffect(() => {
    activePageSizeRef.current = activePageSize;
  }, [activePageSize]);

  useEffect(() => {
    closedPageRef.current = closedPage;
  }, [closedPage]);

  useEffect(() => {
    closedPageSizeRef.current = closedPageSize;
  }, [closedPageSize]);

  useEffect(() => {
    closedExpandedRef.current = closedExpanded;
  }, [closedExpanded]);

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
      updatingIdRef.current !== null ||
      tagInteractionCountRef.current > 0 ||
      clientActionId !== null
    );
  }, [clientActionId]);

  useEffect(() => {
    setActiveRequests(initialActiveRequests);
    setActiveTotal(initialActiveTotal);
    setActivePage(initialActivePage);
    setActivePageSize(initialActivePageSize);
    setClosedTotal(initialClosedTotal);
    setLastUpdatedAt(new Date());
  }, [
    initialActiveRequests,
    initialActiveTotal,
    initialActivePage,
    initialActivePageSize,
    initialClosedTotal,
  ]);

  const activeTotalPages = Math.max(1, Math.ceil(activeTotal / activePageSize));
  const closedTotalPages = Math.max(1, Math.ceil(closedTotal / closedPageSize));

  const fetchSection = useCallback(
    async (
      section: "active" | "closed",
      targetPage: number,
      pageSize: number,
      currentFilters: BookingRequestListFilters,
    ): Promise<BookingRequestListApiPayload> => {
      const response = await fetch(
        buildBookingRequestsListUrl({
          section,
          page: targetPage,
          pageSize,
          filters: currentFilters,
        }),
        { cache: "no-store" },
      );
      const data =
        await readApiJsonResponse<BookingRequestListApiPayload>(response);
      if (!response.ok || !data.ok || !data.requests) {
        throw new Error(data.error ?? "Не удалось загрузить заявки");
      }
      return data;
    },
    [],
  );

  const applyActivePayload = useCallback((payload: BookingRequestListApiPayload) => {
    setActiveRequests(payload.requests ?? []);
    setActivePage(payload.page ?? 1);
    setActiveTotal(payload.activeTotal ?? payload.total ?? 0);
    if (typeof payload.closedTotal === "number") {
      setClosedTotal(payload.closedTotal);
    }
  }, []);

  const applyClosedPayload = useCallback((payload: BookingRequestListApiPayload) => {
    setClosedRequests(payload.requests ?? []);
    setClosedPage(payload.page ?? 1);
    setClosedTotal(payload.closedTotal ?? payload.total ?? 0);
    setClosedLoaded(true);
    if (typeof payload.activeTotal === "number") {
      setActiveTotal(payload.activeTotal);
    }
  }, []);

  const loadActivePage = useCallback(
    async (targetPage: number, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setActiveLoading(true);
      }
      try {
        const payload = await fetchSection(
          "active",
          targetPage,
          activePageSizeRef.current,
          filtersRef.current,
        );
        const totalPages = Math.max(
          1,
          Math.ceil((payload.total ?? 0) / activePageSizeRef.current),
        );
        const nextPage =
          payload.requests && payload.requests.length === 0 && targetPage > 1
            ? totalPages
            : targetPage;
        if (nextPage !== targetPage) {
          const adjusted = await fetchSection(
            "active",
            nextPage,
            activePageSizeRef.current,
            filtersRef.current,
          );
          applyActivePayload(adjusted);
          setActivePage(nextPage);
        } else {
          applyActivePayload(payload);
          setActivePage(targetPage);
        }
        setLastUpdatedAt(new Date());
        setRefreshError(null);
      } catch {
        setRefreshError("Не удалось обновить заявки. Попробуйте ещё раз.");
      } finally {
        if (!options?.silent) {
          setActiveLoading(false);
        }
      }
    },
    [applyActivePayload, fetchSection],
  );

  const loadClosedPage = useCallback(
    async (targetPage: number, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setClosedLoading(true);
      }
      try {
        const payload = await fetchSection(
          "closed",
          targetPage,
          closedPageSizeRef.current,
          filtersRef.current,
        );
        const totalPages = Math.max(
          1,
          Math.ceil((payload.total ?? 0) / closedPageSizeRef.current),
        );
        const nextPage =
          payload.requests && payload.requests.length === 0 && targetPage > 1
            ? totalPages
            : targetPage;
        if (nextPage !== targetPage) {
          const adjusted = await fetchSection(
            "closed",
            nextPage,
            closedPageSizeRef.current,
            filtersRef.current,
          );
          applyClosedPayload(adjusted);
          setClosedPage(nextPage);
        } else {
          applyClosedPayload(payload);
          setClosedPage(targetPage);
        }
        setLastUpdatedAt(new Date());
        setRefreshError(null);
      } catch {
        setRefreshError("Не удалось обновить заявки. Попробуйте ещё раз.");
      } finally {
        if (!options?.silent) {
          setClosedLoading(false);
        }
      }
    },
    [applyClosedPayload, fetchSection],
  );

  const refreshCurrentPages = useCallback(
    async (options?: { manual?: boolean }) => {
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
        const tasks = [
          loadActivePage(activePageRef.current, { silent: true }),
        ];
        if (closedExpandedRef.current) {
          tasks.push(loadClosedPage(closedPageRef.current, { silent: true }));
        }
        await Promise.all(tasks);
      } finally {
        refreshInFlightRef.current = false;
        setIsFetching(false);
        if (options?.manual) {
          setRefreshing(false);
        }
      }
    },
    [isAutoRefreshPaused, loadActivePage, loadClosedPage],
  );

  useEffect(() => {
    void loadActivePage(activePage);
  }, [
    activePage,
    activePageSize,
    filters.phone,
    filters.name,
    filters.dateFrom,
    filters.dateTo,
    filters.status,
    loadActivePage,
  ]);

  useEffect(() => {
    if (!closedExpanded) {
      return;
    }
    void loadClosedPage(closedPage);
  }, [
    closedExpanded,
    closedPage,
    closedPageSize,
    filters.phone,
    filters.name,
    filters.dateFrom,
    filters.dateTo,
    filters.status,
    loadClosedPage,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshCurrentPages();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshCurrentPages]);

  useEffect(() => {
    if (filters.status === "CLOSED") {
      setClosedExpanded(true);
    }
  }, [filters.status]);

  const resetFilters = () => {
    setFilters(DEFAULT_BOOKING_REQUEST_FILTERS);
    setActivePage(1);
    setClosedPage(1);
    setClosedLoaded(false);
    setClosedExpanded(false);
  };

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

        await Promise.all([
          loadActivePage(activePageRef.current, { silent: true }),
          closedExpandedRef.current
            ? loadClosedPage(closedPageRef.current, { silent: true })
            : Promise.resolve(),
        ]);
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
    [loadActivePage, loadClosedPage],
  );

  const handleClientTagsChange = useCallback((clientId: string, tags: string[]) => {
    const patchTags = (requests: BookingRequestDto[]) =>
      requests.map((request) =>
        request.client?.id === clientId
          ? {
              ...request,
              client: request.client ? { ...request.client, tags } : null,
            }
          : request,
      );
    setActiveRequests((current) => patchTags(current));
    setClosedRequests((current) => patchTags(current));
  }, []);

  const linkRequestToClient = useCallback(
    async (requestId: string, clientId: string) => {
      setClientActionId(requestId);
      setError(null);
      try {
        const response = await fetch("/api/admin/booking-requests/link-client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, clientId }),
        });
        const data = await readApiJsonResponse<{
          ok?: boolean;
          request?: BookingRequestDto;
          error?: string;
        }>(response);
        if (!response.ok || !data.ok || !data.request) {
          throw new Error(data.error ?? "Не удалось связать заявку с клиентом");
        }
        setActiveRequests((current) =>
          patchRequestInList(current, data.request!),
        );
        setClosedRequests((current) =>
          patchRequestInList(current, data.request!),
        );
        setLastUpdatedAt(new Date());
      } catch (linkError) {
        setError(
          linkError instanceof Error
            ? linkError.message
            : "Не удалось связать заявку с клиентом",
        );
      } finally {
        setClientActionId(null);
      }
    },
    [],
  );

  const createSeparateClient = useCallback(async (requestId: string) => {
    setClientActionId(requestId);
    setError(null);
    try {
      const response = await fetch("/api/admin/booking-requests/create-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const data = await readApiJsonResponse<{
        ok?: boolean;
        request?: BookingRequestDto;
        error?: string;
      }>(response);
      if (!response.ok || !data.ok || !data.request) {
        throw new Error(data.error ?? "Не удалось создать отдельного клиента");
      }
      setActiveRequests((current) =>
        patchRequestInList(current, data.request!),
      );
      setClosedRequests((current) =>
        patchRequestInList(current, data.request!),
      );
      setLastUpdatedAt(new Date());
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Не удалось создать отдельного клиента",
      );
    } finally {
      setClientActionId(null);
    }
  }, []);

  const filtersApplied = hasNonDefaultBookingRequestFilters(filters);
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
              onChange={(event) => {
                setActivePage(1);
                setClosedPage(1);
                setFilters((current) => ({
                  ...current,
                  phone: event.target.value,
                }));
              }}
              placeholder="Телефон"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Имя</span>
            <input
              type="text"
              value={filters.name}
              onChange={(event) => {
                setActivePage(1);
                setClosedPage(1);
                setFilters((current) => ({
                  ...current,
                  name: event.target.value,
                }));
              }}
              placeholder="Имя"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Дата от</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => {
                setActivePage(1);
                setClosedPage(1);
                setFilters((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }));
              }}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Дата до</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => {
                setActivePage(1);
                setClosedPage(1);
                setFilters((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }));
              }}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Статус</span>
            <select
              value={filters.status}
              onChange={(event) => {
                setActivePage(1);
                setClosedPage(1);
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as BookingRequestListFilters["status"],
                }));
              }}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              {BOOKING_REQUEST_STATUS_FILTER_OPTIONS.map((option) => (
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
              onClick={() => void refreshCurrentPages({ manual: true })}
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
            {activeTotal > 0 ? ` (${activeTotal})` : ""}
          </h2>
          {activeRequests.length > 0 ? (
            <>
              <RequestTable
                requests={activeRequests}
                updatingId={updatingId}
                clientActionId={clientActionId}
                onStatusChange={(id, status) => void updateStatus(id, status)}
                onLinkClient={(requestId, clientId) =>
                  void linkRequestToClient(requestId, clientId)
                }
                onCreateSeparateClient={(requestId) =>
                  void createSeparateClient(requestId)
                }
                onClientTagsChange={handleClientTagsChange}
                onTagInteractionChange={handleTagInteractionChange}
              />
              <ListPaginationBar
                shownCount={activeRequests.length}
                total={activeTotal}
                page={activePage}
                totalPages={activeTotalPages}
                pageSize={activePageSize}
                pageSizes={BOOKING_REQUEST_LIST_PAGE_SIZES}
                loading={activeLoading}
                onPageSizeChange={(size) => {
                  setActivePageSize(size);
                  setActivePage(1);
                }}
                onPrevious={() =>
                  setActivePage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setActivePage((current) =>
                    Math.min(activeTotalPages, current + 1),
                  )
                }
              />
            </>
          ) : activeLoading ? (
            <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
              Загрузка…
            </div>
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
            <span>Закрытые заявки ({closedTotal})</span>
            <span aria-hidden="true">{closedExpanded ? "▲" : "▼"}</span>
          </button>

          {closedExpanded ? (
            closedRequests.length > 0 || closedLoading ? (
              <div className="space-y-3">
                {closedRequests.length > 0 ? (
                  <RequestTable
                    requests={closedRequests}
                    updatingId={updatingId}
                    clientActionId={clientActionId}
                    onStatusChange={(id, status) => void updateStatus(id, status)}
                    onLinkClient={(requestId, clientId) =>
                      void linkRequestToClient(requestId, clientId)
                    }
                    onCreateSeparateClient={(requestId) =>
                      void createSeparateClient(requestId)
                    }
                    onClientTagsChange={handleClientTagsChange}
                    onTagInteractionChange={handleTagInteractionChange}
                  />
                ) : (
                  <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
                    Загрузка…
                  </div>
                )}
                <ListPaginationBar
                  shownCount={closedRequests.length}
                  total={closedTotal}
                  page={closedPage}
                  totalPages={closedTotalPages}
                  pageSize={closedPageSize}
                  pageSizes={BOOKING_REQUEST_LIST_PAGE_SIZES}
                  loading={closedLoading}
                  onPageSizeChange={(size) => {
                    setClosedPageSize(size);
                    setClosedPage(1);
                  }}
                  onPrevious={() =>
                    setClosedPage((current) => Math.max(1, current - 1))
                  }
                  onNext={() =>
                    setClosedPage((current) =>
                      Math.min(closedTotalPages, current + 1),
                    )
                  }
                />
              </div>
            ) : closedLoaded ? (
              <EmptyState message={closedEmptyMessage} />
            ) : null
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
