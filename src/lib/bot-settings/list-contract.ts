export const BOT_EVENT_LOG_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_BOT_EVENT_LOG_PAGE_SIZE = 25;

export type BotEventLogLevelFilter = "all" | "errors" | "events";

export type BotEventLogListFilters = {
  levelFilter: BotEventLogLevelFilter;
  dateFrom: string;
  dateTo: string;
};

export const DEFAULT_BOT_EVENT_LOG_FILTERS: BotEventLogListFilters = {
  levelFilter: "all",
  dateFrom: "",
  dateTo: "",
};

export const BOT_EVENT_LOG_LEVEL_FILTER_OPTIONS: {
  value: BotEventLogLevelFilter;
  label: string;
}[] = [
  { value: "all", label: "Все события" },
  { value: "errors", label: "Ошибки" },
  { value: "events", label: "Обычные события" },
];

export type BotEventLogListQuery = {
  page?: number;
  pageSize?: number;
  levelFilter?: BotEventLogLevelFilter;
  dateFrom?: string;
  dateTo?: string;
};

export function buildBotEventLogsListUrl({
  page,
  pageSize,
  filters,
}: {
  page: number;
  pageSize: number;
  filters: BotEventLogListFilters;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("levelFilter", filters.levelFilter);

  if (filters.dateFrom) {
    params.set("dateFrom", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("dateTo", filters.dateTo);
  }

  return `/api/admin/bot/events?${params.toString()}`;
}
