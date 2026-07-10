export type BookingRequestSection = "active" | "closed";

export type BookingRequestStatusFilter =
  | "ACTIVE"
  | "NEW"
  | "CONTACTED"
  | "CLOSED"
  | "ALL";

export type BookingRequestListFilters = {
  phone: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  status: BookingRequestStatusFilter;
};

export const DEFAULT_BOOKING_REQUEST_FILTERS: BookingRequestListFilters = {
  phone: "",
  name: "",
  dateFrom: "",
  dateTo: "",
  status: "ACTIVE",
};

export const BOOKING_REQUEST_LIST_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE = 25;

export type BookingRequestListQuery = {
  section: BookingRequestSection;
  page?: number;
  pageSize?: number;
  phone?: string;
  name?: string;
  dateFrom?: string;
  dateTo?: string;
  statusFilter?: BookingRequestStatusFilter;
};

export const BOOKING_REQUEST_STATUS_FILTER_OPTIONS: {
  value: BookingRequestStatusFilter;
  label: string;
}[] = [
  { value: "ACTIVE", label: "Все активные" },
  { value: "NEW", label: "Новая" },
  { value: "CONTACTED", label: "Связались" },
  { value: "CLOSED", label: "Закрыта" },
  { value: "ALL", label: "Все" },
];

export function buildBookingRequestsListUrl({
  section,
  page,
  pageSize,
  filters,
}: {
  section: BookingRequestSection;
  page: number;
  pageSize: number;
  filters: BookingRequestListFilters;
}): string {
  const params = new URLSearchParams();
  params.set("section", section);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("statusFilter", filters.status);

  const phone = filters.phone.trim();
  if (phone) {
    params.set("phone", phone);
  }

  const name = filters.name.trim();
  if (name) {
    params.set("name", name);
  }

  if (filters.dateFrom) {
    params.set("dateFrom", filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set("dateTo", filters.dateTo);
  }

  return `/api/booking/requests?${params.toString()}`;
}

export function hasNonDefaultBookingRequestFilters(
  filters: BookingRequestListFilters,
): boolean {
  return (
    filters.phone.trim().length > 0 ||
    filters.name.trim().length > 0 ||
    filters.dateFrom.length > 0 ||
    filters.dateTo.length > 0 ||
    filters.status !== "ACTIVE"
  );
}
