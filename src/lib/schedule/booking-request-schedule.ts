import type { BookingRequestType } from "@prisma/client";

/**
 * Minimal public/view-only card fields: time, type/status, name, service.
 * No phone, email, comment, manage links, or internal schedule hrefs.
 */
export type SummaryScheduleBookingRequestDto = {
  id: string;
  createdAt: string;
  clientName: string;
  status: "NEW" | "CONTACTED" | "CLOSED";
  type: BookingRequestType;
  isFromGame: boolean;
  serviceNameSnapshot: string | null;
  appointmentServiceName: string | null;
};

export type MasterScheduleBookingRequestDto = SummaryScheduleBookingRequestDto & {
  masterName: string | null;
  serviceId: string | null;
  appointmentId: string | null;
  appointmentStartsAt: string | null;
  appointmentScheduleHref: string | null;
};

export type FullScheduleBookingRequestDto = MasterScheduleBookingRequestDto & {
  clientPhone: string;
  comment: string | null;
};

export type ScheduleDayBookingRequest =
  | SummaryScheduleBookingRequestDto
  | MasterScheduleBookingRequestDto
  | FullScheduleBookingRequestDto;

/** Keys that must never appear on view-only / summary booking-request DTOs. */
export const FORBIDDEN_VIEW_ONLY_BOOKING_REQUEST_KEYS = [
  "clientPhone",
  "phone",
  "email",
  "comment",
  "manageToken",
  "manageTokenHash",
  "masterName",
  "serviceId",
  "appointmentId",
  "appointmentStartsAt",
  "appointmentScheduleHref",
] as const;

export function isFullScheduleBookingRequest(
  request: ScheduleDayBookingRequest,
): request is FullScheduleBookingRequestDto {
  return "clientPhone" in request;
}

export function isMasterScheduleBookingRequest(
  request: ScheduleDayBookingRequest,
): request is MasterScheduleBookingRequestDto {
  return "appointmentScheduleHref" in request && !("clientPhone" in request);
}

export function isSummaryScheduleBookingRequest(
  request: ScheduleDayBookingRequest,
): request is SummaryScheduleBookingRequestDto {
  return !("appointmentScheduleHref" in request) && !("clientPhone" in request);
}

export function toMasterScheduleBookingRequest(
  request: FullScheduleBookingRequestDto,
): MasterScheduleBookingRequestDto {
  return {
    id: request.id,
    createdAt: request.createdAt,
    clientName: request.clientName,
    status: request.status,
    type: request.type,
    isFromGame: request.isFromGame,
    masterName: request.masterName,
    serviceId: request.serviceId,
    serviceNameSnapshot: request.serviceNameSnapshot,
    appointmentId: request.appointmentId,
    appointmentStartsAt: request.appointmentStartsAt,
    appointmentServiceName: request.appointmentServiceName,
    appointmentScheduleHref: request.appointmentScheduleHref,
  };
}

export function toSummaryScheduleBookingRequest(
  request: Pick<
    FullScheduleBookingRequestDto,
    | "id"
    | "createdAt"
    | "clientName"
    | "status"
    | "type"
    | "isFromGame"
    | "serviceNameSnapshot"
    | "appointmentServiceName"
  >,
): SummaryScheduleBookingRequestDto {
  return {
    id: request.id,
    createdAt: request.createdAt,
    clientName: request.clientName,
    status: request.status,
    type: request.type,
    isFromGame: request.isFromGame,
    serviceNameSnapshot: request.serviceNameSnapshot,
    appointmentServiceName: request.appointmentServiceName,
  };
}

export function collectForbiddenViewOnlyBookingRequestKeys(
  value: Record<string, unknown>,
): string[] {
  return FORBIDDEN_VIEW_ONLY_BOOKING_REQUEST_KEYS.filter((key) => key in value);
}

export function getScheduleBookingRequestSourceLabel(
  request: Pick<ScheduleDayBookingRequest, "type" | "isFromGame">,
): string {
  if (request.isFromGame) {
    return "Игра «Поймай своё время»";
  }
  if (request.type === "CONSULTATION_REQUEST") {
    return "Консультация";
  }
  if (request.type === "MANAGER_REQUEST") {
    return "Онлайн-запись";
  }
  if (request.type === "RESCHEDULE_REQUEST") {
    return "Перенос записи";
  }
  return "Заявка";
}

export function getScheduleBookingRequestShortSourceLabel(
  request: Pick<ScheduleDayBookingRequest, "type" | "isFromGame">,
): string {
  if (request.isFromGame) {
    return "Игра";
  }
  if (request.type === "CONSULTATION_REQUEST") {
    return "Консультация";
  }
  if (request.type === "MANAGER_REQUEST") {
    return "Онлайн-заявка";
  }
  if (request.type === "RESCHEDULE_REQUEST") {
    return "Перенос";
  }
  return "Заявка";
}

export function truncateScheduleText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function getBookingRequestCommentPreview(
  comment: string | null,
  maxLines = 2,
): string | null {
  if (!comment?.trim()) {
    return null;
  }

  const lines = comment
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  return lines.slice(0, maxLines).join("\n");
}

export function extractGiftFromBookingComment(comment: string | null): string | null {
  if (!comment) {
    return null;
  }

  const lines = comment.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "Подарок:" && lines[index + 1]) {
      return lines[index + 1].trim();
    }
    if (line.startsWith("Подарок:")) {
      return line.slice("Подарок:".length).trim() || null;
    }
  }

  return null;
}
