import type { ClientStatus } from "@prisma/client";

export const CLIENT_LIST_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_CLIENT_LIST_PAGE_SIZE = 25;

export type ClientArchiveFilter = "all" | "active" | "archived";
export type ClientStatusFilter = "all" | ClientStatus;

export type ClientListFilters = {
  search: string;
  status: ClientStatusFilter;
  archive: ClientArchiveFilter;
};

export const DEFAULT_CLIENT_LIST_FILTERS: ClientListFilters = {
  search: "",
  status: "all",
  archive: "active",
};

export function buildClientsListUrl({
  page,
  pageSize,
  search,
  statusFilter,
  archiveFilter,
}: {
  page: number;
  pageSize: number;
  search: string;
  statusFilter: ClientStatusFilter;
  archiveFilter: ClientArchiveFilter;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const query = search.trim();
  if (query) {
    params.set("q", query);
  }
  if (statusFilter !== "all") {
    params.set("status", statusFilter);
  }
  params.set("archive", archiveFilter);
  return `/api/admin/clients?${params.toString()}`;
}
