import "server-only";

import type { Prisma } from "@prisma/client";
import {
  COMM_CONTACT_LIST_PAGE_SIZES,
  DEFAULT_COMM_CONTACT_LIST_FILTERS,
  DEFAULT_COMM_CONTACT_LIST_PAGE_SIZE,
  type CommContactListFilters,
} from "@/lib/communications/list-contract";

function parsePageSize(raw: string | null): number {
  const value = Number(raw);
  if (
    COMM_CONTACT_LIST_PAGE_SIZES.includes(
      value as (typeof COMM_CONTACT_LIST_PAGE_SIZES)[number],
    )
  ) {
    return value;
  }
  return DEFAULT_COMM_CONTACT_LIST_PAGE_SIZE;
}

function parsePage(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

export type ParsedCommContactListQuery = {
  page: number;
  pageSize: number;
  filters: CommContactListFilters;
};

export function parseCommContactListQuery(
  searchParams: URLSearchParams,
): ParsedCommContactListQuery {
  const filters: CommContactListFilters = {
    ...DEFAULT_COMM_CONTACT_LIST_FILTERS,
    search: searchParams.get("q")?.trim() ?? "",
    source: (searchParams.get("source") as CommContactListFilters["source"]) || "all",
    deliveryStatus:
      (searchParams.get(
        "deliveryStatus",
      ) as CommContactListFilters["deliveryStatus"]) || "all",
    consentStatus:
      (searchParams.get(
        "consentStatus",
      ) as CommContactListFilters["consentStatus"]) || "all",
    unsubscribed:
      (searchParams.get(
        "unsubscribed",
      ) as CommContactListFilters["unsubscribed"]) || "all",
    linkedClient:
      (searchParams.get(
        "linkedClient",
      ) as CommContactListFilters["linkedClient"]) || "all",
    tag: searchParams.get("tag")?.trim() ?? "",
    lastInteractionFrom: searchParams.get("lastInteractionFrom")?.trim() ?? "",
    lastInteractionTo: searchParams.get("lastInteractionTo")?.trim() ?? "",
  };

  return {
    page: parsePage(searchParams.get("page")),
    pageSize: parsePageSize(searchParams.get("pageSize")),
    filters,
  };
}

export function buildCommContactWhere(
  filters: CommContactListFilters,
): Prisma.CommunicationContactWhereInput {
  const where: Prisma.CommunicationContactWhereInput = {};
  const and: Prisma.CommunicationContactWhereInput[] = [];

  if (filters.search) {
    and.push({
      displayName: { contains: filters.search, mode: "insensitive" },
    });
  }

  if (filters.source !== "all") {
    where.source = filters.source;
  }
  if (filters.deliveryStatus !== "all") {
    where.deliveryStatus = filters.deliveryStatus;
  }
  if (filters.consentStatus !== "all") {
    where.consentStatus = filters.consentStatus;
  }
  if (filters.unsubscribed === "yes") {
    where.isUnsubscribed = true;
  } else if (filters.unsubscribed === "no") {
    where.isUnsubscribed = false;
  }
  if (filters.linkedClient === "yes") {
    where.clientId = { not: null };
  } else if (filters.linkedClient === "no") {
    where.clientId = null;
  }
  if (filters.tag) {
    where.tags = { has: filters.tag };
  }

  if (filters.lastInteractionFrom || filters.lastInteractionTo) {
    const range: Prisma.DateTimeNullableFilter = {};
    if (filters.lastInteractionFrom) {
      range.gte = new Date(`${filters.lastInteractionFrom}T00:00:00.000Z`);
    }
    if (filters.lastInteractionTo) {
      range.lte = new Date(`${filters.lastInteractionTo}T23:59:59.999Z`);
    }
    where.lastInteractionAt = range;
  }

  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}
