import "server-only";

import type { BookingRequestStatus, Prisma } from "@prisma/client";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import {
  BOOKING_REQUEST_LIST_PAGE_SIZES,
  DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
  type BookingRequestListQuery,
  type BookingRequestStatusFilter,
} from "@/lib/booking-requests/list-contract";

export type {
  BookingRequestListQuery,
  BookingRequestSection,
  BookingRequestStatusFilter,
} from "@/lib/booking-requests/list-contract";

export {
  BOOKING_REQUEST_LIST_PAGE_SIZES,
  DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
} from "@/lib/booking-requests/list-contract";

export function parseBookingRequestListQuery(
  searchParams: URLSearchParams,
): BookingRequestListQuery {
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(
    searchParams.get("pageSize") ?? String(DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE),
    10,
  );
  const section = searchParams.get("section");
  const statusFilter = searchParams.get("statusFilter");

  return {
    section: section === "closed" ? "closed" : "active",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: BOOKING_REQUEST_LIST_PAGE_SIZES.includes(
      pageSize as (typeof BOOKING_REQUEST_LIST_PAGE_SIZES)[number],
    )
      ? pageSize
      : DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
    phone: searchParams.get("phone")?.trim() || undefined,
    name: searchParams.get("name")?.trim() || undefined,
    dateFrom: searchParams.get("dateFrom")?.trim() || undefined,
    dateTo: searchParams.get("dateTo")?.trim() || undefined,
    statusFilter:
      statusFilter === "NEW" ||
      statusFilter === "CONTACTED" ||
      statusFilter === "CLOSED" ||
      statusFilter === "ALL"
        ? statusFilter
        : "ACTIVE",
  };
}

function buildFieldFilters(
  query: Pick<
    BookingRequestListQuery,
    "phone" | "name" | "dateFrom" | "dateTo"
  >,
): Prisma.BookingRequestWhereInput {
  const and: Prisma.BookingRequestWhereInput[] = [];

  const phone = query.phone?.trim();
  if (phone) {
    and.push({ clientPhone: { contains: phone } });
  }

  const name = query.name?.trim();
  if (name) {
    and.push({ clientName: { contains: name, mode: "insensitive" } });
  }

  if (query.dateFrom) {
    const { dayStart } = getStudioDayRangeFromDateKey(query.dateFrom);
    and.push({ createdAt: { gte: dayStart } });
  }

  if (query.dateTo) {
    const { dayEnd } = getStudioDayRangeFromDateKey(query.dateTo);
    and.push({ createdAt: { lte: dayEnd } });
  }

  if (and.length === 0) {
    return {};
  }

  return { AND: and };
}

function activeStatusesForFilter(
  statusFilter: BookingRequestStatusFilter = "ACTIVE",
): BookingRequestStatus[] {
  if (statusFilter === "NEW") {
    return ["NEW"];
  }
  if (statusFilter === "CONTACTED") {
    return ["CONTACTED"];
  }
  return ["NEW", "CONTACTED"];
}

export function buildBookingRequestSectionWhere(
  query: BookingRequestListQuery,
): Prisma.BookingRequestWhereInput {
  const fieldFilters = buildFieldFilters(query);
  const statusFilter = query.statusFilter ?? "ACTIVE";

  if (query.section === "closed") {
    return {
      ...fieldFilters,
      status: "CLOSED",
    };
  }

  return {
    ...fieldFilters,
    status: { in: activeStatusesForFilter(statusFilter) },
  };
}

export function buildBookingRequestActiveCountWhere(
  query: Pick<
    BookingRequestListQuery,
    "phone" | "name" | "dateFrom" | "dateTo" | "statusFilter"
  >,
): Prisma.BookingRequestWhereInput {
  const statusFilter = query.statusFilter ?? "ACTIVE";
  if (statusFilter === "CLOSED") {
    return {
      ...buildFieldFilters(query),
      id: "00000000-0000-0000-0000-000000000000",
    };
  }

  return {
    ...buildFieldFilters(query),
    status: { in: activeStatusesForFilter(statusFilter) },
  };
}

export function buildBookingRequestClosedCountWhere(
  query: Pick<
    BookingRequestListQuery,
    "phone" | "name" | "dateFrom" | "dateTo"
  >,
): Prisma.BookingRequestWhereInput {
  return {
    ...buildFieldFilters(query),
    status: "CLOSED",
  };
}
