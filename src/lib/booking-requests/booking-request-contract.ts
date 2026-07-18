import type {
  BookingRequestSource,
  BookingRequestStatus,
  BookingRequestType,
  ClientStatus,
} from "@prisma/client";

export type BookingRequestClientLinkStatus =
  | "linked"
  | "new"
  | "none"
  | "duplicate"
  | "name_duplicate";

export type BookingRequestClientSummary = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  status: ClientStatus;
  isArchived: boolean;
};

export type BookingRequestDto = {
  id: string;
  clientName: string;
  clientPhone: string;
  comment: string | null;
  masterId: string | null;
  masterName: string | null;
  serviceId: string | null;
  serviceNameSnapshot: string | null;
  status: BookingRequestStatus;
  source: BookingRequestSource;
  type: BookingRequestType;
  createdAt: string;
  clientId: string | null;
  clientLinkStatus: BookingRequestClientLinkStatus;
  client: BookingRequestClientSummary | null;
  hasPossibleClientDuplicates: boolean;
  possibleDuplicateClients: BookingRequestClientSummary[];
  duplicateReason: string | null;
  appointmentId: string | null;
  appointmentServiceName: string | null;
  appointmentStartsAt: string | null;
  appointmentScheduleHref: string | null;
};

export type BookingRequestListApiPayload = {
  ok?: boolean;
  requests?: BookingRequestDto[];
  total?: number;
  page?: number;
  pageSize?: number;
  activeTotal?: number;
  closedTotal?: number;
  error?: string;
};

const REQUEST_TYPE_LABELS: Record<BookingRequestType, string> = {
  MANAGER_REQUEST: "Заявка через менеджера",
  CONSULTATION_REQUEST: "Консультация",
  RESCHEDULE_REQUEST: "Перенос записи",
};

const REQUEST_STATUS_LABELS: Record<BookingRequestStatus, string> = {
  NEW: "Новая",
  CONTACTED: "Связались",
  CLOSED: "Закрыта",
};

const CLIENT_LINK_LABELS: Record<BookingRequestClientLinkStatus, string> = {
  linked: "Клиент найден",
  new: "Новый клиент",
  none: "Не связан с карточкой",
  duplicate: "Возможный дубль",
  name_duplicate: "Возможный дубль",
};

export function getBookingRequestTypeLabel(type: BookingRequestType): string {
  return REQUEST_TYPE_LABELS[type];
}

export function getBookingRequestStatusLabel(
  status: BookingRequestStatus,
): string {
  return REQUEST_STATUS_LABELS[status];
}

export function getBookingRequestClientLinkLabel(
  status: BookingRequestClientLinkStatus,
): string {
  return CLIENT_LINK_LABELS[status];
}
