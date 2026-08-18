import type { BookingRequestType } from "@prisma/client";
import {
  LEGACY_CATCH_TIME_GAME_TITLE,
  type GameBookingRequestDisplay,
} from "@/lib/schedule/game-booking-request-display-format";

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
  gameDisplay?: GameBookingRequestDisplay | null;
};

export type MasterScheduleBookingRequestDto = SummaryScheduleBookingRequestDto & {
  masterName: string | null;
  serviceId: string | null;
  appointmentId: string | null;
  appointmentStartsAt: string | null;
  appointmentScheduleHref: string | null;
  gameDisplay?: GameBookingRequestDisplay | null;
};

export type FullScheduleBookingRequestDto = MasterScheduleBookingRequestDto & {
  clientPhone: string;
  comment: string | null;
  gameDisplay?: GameBookingRequestDisplay | null;
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
    gameDisplay: request.gameDisplay ?? null,
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
    | "gameDisplay"
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
    gameDisplay: request.gameDisplay ?? null,
  };
}

export function collectForbiddenViewOnlyBookingRequestKeys(
  value: Record<string, unknown>,
): string[] {
  return FORBIDDEN_VIEW_ONLY_BOOKING_REQUEST_KEYS.filter((key) => key in value);
}

export function getScheduleBookingRequestSourceLabel(
  request: Pick<ScheduleDayBookingRequest, "type" | "isFromGame"> & {
    gameDisplay?: GameBookingRequestDisplay | null;
  },
): string {
  if (request.isFromGame) {
    const title =
      request.gameDisplay?.catalogTitle?.trim() || LEGACY_CATCH_TIME_GAME_TITLE;
    return `Игра «${title}»`;
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
  if (request.type === "WEBSITE_PROBLEM_REPORT") {
    return "Проблема на сайте";
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
  if (request.type === "WEBSITE_PROBLEM_REPORT") {
    return "Проблема";
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

  const labels = [
    "Итоговый подарок:",
    "Итоговый приз:",
    "Подарок (назначен сервером):",
    "Подарок:",
  ];

  const lines = comment.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    for (const label of labels) {
      if (line === label && lines[index + 1]) {
        const next = lines[index + 1]!.trim();
        if (next && next !== "—") {
          return next;
        }
      }
      if (line.startsWith(label)) {
        const inline = line.slice(label.length).trim();
        if (inline && inline !== "—") {
          return inline;
        }
      }
    }
  }

  return null;
}
