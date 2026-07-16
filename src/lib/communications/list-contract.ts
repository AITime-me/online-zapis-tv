export const COMM_CONTACT_LIST_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_COMM_CONTACT_LIST_PAGE_SIZE = 25;

export type CommContactListFilters = {
  search: string;
  source: "all" | "SALEBOT_IMPORT" | "VK_WEBHOOK" | "MANUAL";
  deliveryStatus: "all" | "UNKNOWN" | "ALLOWED" | "DENIED" | "BLOCKED";
  consentStatus: "all" | "UNKNOWN" | "CONFIRMED" | "REVOKED";
  unsubscribed: "all" | "yes" | "no";
  linkedClient: "all" | "yes" | "no";
  tag: string;
  lastInteractionFrom: string;
  lastInteractionTo: string;
};

export const DEFAULT_COMM_CONTACT_LIST_FILTERS: CommContactListFilters = {
  search: "",
  source: "all",
  deliveryStatus: "all",
  consentStatus: "all",
  unsubscribed: "all",
  linkedClient: "all",
  tag: "",
  lastInteractionFrom: "",
  lastInteractionTo: "",
};

export function buildCommContactsListUrl({
  page,
  pageSize,
  filters,
}: {
  page: number;
  pageSize: number;
  filters: CommContactListFilters;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }
  if (filters.source !== "all") {
    params.set("source", filters.source);
  }
  if (filters.deliveryStatus !== "all") {
    params.set("deliveryStatus", filters.deliveryStatus);
  }
  if (filters.consentStatus !== "all") {
    params.set("consentStatus", filters.consentStatus);
  }
  if (filters.unsubscribed !== "all") {
    params.set("unsubscribed", filters.unsubscribed);
  }
  if (filters.linkedClient !== "all") {
    params.set("linkedClient", filters.linkedClient);
  }
  if (filters.tag.trim()) {
    params.set("tag", filters.tag.trim());
  }
  if (filters.lastInteractionFrom) {
    params.set("lastInteractionFrom", filters.lastInteractionFrom);
  }
  if (filters.lastInteractionTo) {
    params.set("lastInteractionTo", filters.lastInteractionTo);
  }
  return `/api/admin/communications/contacts?${params.toString()}`;
}
