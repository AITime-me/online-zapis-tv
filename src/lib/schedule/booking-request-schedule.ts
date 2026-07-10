import type { BookingRequestType } from "@prisma/client";

export type MasterScheduleBookingRequestDto = {
  id: string;
  createdAt: string;
  clientName: string;
  status: "NEW" | "CONTACTED" | "CLOSED";
  type: BookingRequestType;
  isFromGame: boolean;
  masterName: string | null;
};

export type FullScheduleBookingRequestDto = MasterScheduleBookingRequestDto & {
  clientPhone: string;
  comment: string | null;
};

export type ScheduleDayBookingRequest =
  | MasterScheduleBookingRequestDto
  | FullScheduleBookingRequestDto;

export function isFullScheduleBookingRequest(
  request: ScheduleDayBookingRequest,
): request is FullScheduleBookingRequestDto {
  return "clientPhone" in request;
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
  };
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
