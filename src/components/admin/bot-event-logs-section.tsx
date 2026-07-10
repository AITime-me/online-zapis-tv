"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  BOT_EVENT_LOG_LEVEL_FILTER_OPTIONS,
  BOT_EVENT_LOG_PAGE_SIZES,
  DEFAULT_BOT_EVENT_LOG_FILTERS,
  DEFAULT_BOT_EVENT_LOG_PAGE_SIZE,
  buildBotEventLogsListUrl,
  type BotEventLogListFilters,
} from "@/lib/bot-settings/list-contract";
import type { BotEventLogDto } from "@/types/bot-event-log";
import { ListPaginationBar } from "@/components/admin/list-pagination-bar";

type BotEventLogsResponse = {
  ok: boolean;
  events?: BotEventLogDto[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function levelBadgeClass(level: BotEventLogDto["level"]): string {
  if (level === "error") {
    return "bg-red-100 text-red-800";
  }
  if (level === "warning") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-zinc-100 text-zinc-700";
}

export function BotEventLogsSection() {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<BotEventLogDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_BOT_EVENT_LOG_PAGE_SIZE);
  const [filters, setFilters] = useState<BotEventLogListFilters>(
    DEFAULT_BOT_EVENT_LOG_FILTERS,
  );
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        buildBotEventLogsListUrl({ page, pageSize, filters }),
        { cache: "no-store" },
      );
      const payload = await readApiJsonResponse<BotEventLogsResponse>(response);

      if (!response.ok || !payload.ok || !payload.events) {
        throw new Error(payload.error ?? "Не удалось загрузить события бота");
      }

      setEvents(payload.events);
      setTotal(payload.total ?? 0);
      setLoaded(true);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Не удалось загрузить события бота",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    void fetchEvents();
  }, [expanded, fetchEvents]);

  const updateFilters = (patch: Partial<BotEventLogListFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <section className="space-y-4 rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">События бота</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Журнал событий с серверной пагинацией. Полный журнал не загружается
            до раскрытия блока.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-sm font-medium text-[#1a73e8] hover:underline"
        >
          {expanded ? "Свернуть" : "Развернуть"}
        </button>
      </div>

      {expanded ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-700">
              Фильтр
              <select
                value={filters.levelFilter}
                onChange={(event) =>
                  updateFilters({
                    levelFilter: event.target.value as BotEventLogListFilters["levelFilter"],
                  })
                }
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {BOT_EVENT_LOG_LEVEL_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-700">
              Дата с
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) =>
                  updateFilters({ dateFrom: event.target.value })
                }
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-700">
              Дата по
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) =>
                  updateFilters({ dateTo: event.target.value })
                }
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </label>

            <button
              type="button"
              onClick={() => void fetchEvents()}
              disabled={loading}
              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Обновить
            </button>
          </div>

          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {!loaded && loading ? (
            <p className="text-sm text-zinc-600">Загрузка событий…</p>
          ) : null}

          {loaded && events.length === 0 && !loading ? (
            <div className="rounded border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
              Событий пока нет. После подключения бота здесь появятся записи
              журнала.
            </div>
          ) : null}

          {events.length > 0 ? (
            <div className="overflow-x-auto rounded border border-zinc-200">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">Дата</th>
                    <th className="px-3 py-2">Уровень</th>
                    <th className="px-3 py-2">Тип</th>
                    <th className="px-3 py-2">Канал</th>
                    <th className="px-3 py-2">Событие</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const isOpen = expandedEventId === event.id;
                    return (
                      <tr key={event.id} className="border-t border-zinc-100">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">
                          {formatDateTime(event.createdAt)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${levelBadgeClass(event.level)}`}
                          >
                            {event.levelLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-700">
                          {event.typeLabel}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {event.channel ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedEventId(isOpen ? null : event.id)
                            }
                            className="text-left text-sm text-zinc-900 hover:underline"
                          >
                            {event.title}
                          </button>
                          {isOpen ? (
                            <div className="mt-2 space-y-1 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                              {event.message ? (
                                <p className="whitespace-pre-wrap">{event.message}</p>
                              ) : (
                                <p className="text-zinc-500">Без подробностей</p>
                              )}
                              {event.clientId ? (
                                <p>Клиент: {event.clientId}</p>
                              ) : null}
                              {event.bookingRequestId ? (
                                <p>Заявка: {event.bookingRequestId}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {loaded ? (
            <ListPaginationBar
              shownCount={events.length}
              total={total}
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizes={BOT_EVENT_LOG_PAGE_SIZES}
              loading={loading}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
