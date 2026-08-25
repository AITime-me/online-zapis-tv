/**
 * Contracts for POST /api/internal/bot/v1/booking-requests/*.
 * Validation / error strings never include name, phone, or raw body contents.
 * clientPhone is required in DTO for CRM identity — never log it.
 */

import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";
import {
  formatStudioOffsetDateTime,
  isValidDateKey,
  isValidMonthKey,
} from "@/lib/datetime/date-layer";
import type { GameGiftActivationMode } from "@/lib/game/gift-activation";

export type BotBookingRequestErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "BOOKING_REQUEST_INVALID"
  | "BOOKING_REQUEST_CONFLICT"
  | "CONSULTATION_SERVICE_REQUIRED"
  | "SLOT_NO_LONGER_AVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "MASTER_UNAVAILABLE"
  | "SERVICE_MASTER_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "RECONCILIATION_REQUIRED"
  | "BOOKING_CONFLICT"
  | "INTERNAL_ERROR";

export type BotBookingRequestErrorBody = {
  ok: false;
  code: BotBookingRequestErrorCode;
  error: string;
};

export type BotGameContextEligibilityDto = {
  activationMode: GameGiftActivationMode | null;
  minCourseSessions: number | null;
  managerConfirmationRequired: true;
};

export type BotGameContextDto = {
  gameTitle: string;
  giftName: string | null;
  procedure: string | null;
  zone: string | null;
  activationMode: GameGiftActivationMode | null;
  minCourseSessions: number | null;
  prizeType: string | null;
  eligibility: BotGameContextEligibilityDto;
};

export type BotBookingRequestDto = {
  id: string;
  type: "MANAGER_REQUEST" | "CONSULTATION_REQUEST";
  status: "NEW" | "CONTACTED" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  /** CRM identity — never log. */
  clientName: string;
  /** CRM identity — never log. */
  clientPhone: string;
  masterId: string | null;
  serviceId: string | null;
  serviceNameSnapshot: string | null;
  clientId: string | null;
  appointmentId: string | null;
  gameCatalogId: string | null;
  gameContext: BotGameContextDto | null;
};

export type BotBookingRequestFeedCursor = {
  createdAt: string;
  id: string;
};

export type BotBookingRequestFeedRequest = {
  limit: number;
  cursor?: BotBookingRequestFeedCursor;
};

export type BotBookingRequestFeedSuccess = {
  ok: true;
  items: BotBookingRequestDto[];
  nextCursor: BotBookingRequestFeedCursor | null;
};

export type BotBookingRequestGetRequest = {
  id: string;
};

export type BotBookingRequestGetSuccess = {
  ok: true;
  item: BotBookingRequestDto;
};

export type BotBookingRequestAvailabilityRequest =
  | { requestId: string; date: string }
  | { requestId: string; month: string };

export type BotBookingRequestAvailabilitySlotDto = {
  slotId: string;
  startsAt: string;
};

export type BotBookingRequestAvailabilityDateSuccess = {
  ok: true;
  requestId: string;
  date: string;
  studioToday: string;
  slots: BotBookingRequestAvailabilitySlotDto[];
};

export type BotBookingRequestAvailabilityMonthSuccess = {
  ok: true;
  requestId: string;
  month: string;
  studioToday: string;
  dateKeys: string[];
};

export type BotBookingRequestAvailabilitySuccess =
  | BotBookingRequestAvailabilityDateSuccess
  | BotBookingRequestAvailabilityMonthSuccess;

export type BotBookingRequestAppointmentsLookupRequest =
  | { phone: string }
  | { clientId: string };

export type BotAppointmentCandidateDto = {
  id: string;
  clientId: string;
  masterId: string;
  serviceId: string | null;
  startsAt: string;
  createdAt: string;
  status: "SCHEDULED" | "CONFIRMED";
  source: string;
};

export type BotBookingRequestAppointmentsLookupSuccess = {
  ok: true;
  clientOutcome: "NONE" | "UNIQUE" | "AMBIGUOUS";
  clientId: string | null;
  appointments: BotAppointmentCandidateDto[];
};

export type BotBookingRequestBookRequest = {
  requestId: string;
  startsAt: string;
  idempotencyKey: string;
  serviceId?: string;
};

export type BotBookingRequestBookSuccess = {
  ok: true;
  appointmentId: string;
  requestId: string;
  status: "CLOSED";
  startsAt: string;
  serviceId: string;
  masterId: string;
  idempotentReplay: boolean;
};

export type ParseBotBookingRequestBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

const FEED_KEYS = new Set(["limit", "cursor"]);
const GET_KEYS = new Set(["id"]);
const AVAILABILITY_KEYS = new Set(["requestId", "date", "month"]);
const LOOKUP_KEYS = new Set(["phone", "clientId"]);
const BOOK_KEYS = new Set([
  "requestId",
  "startsAt",
  "idempotencyKey",
  "serviceId",
]);

const STUDIO_OFFSET_STARTS_AT =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):00\+05:00$/;

const CANONICAL_LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCanonicalLowercaseUuid(value: string): boolean {
  return value.length === 36 && CANONICAL_LOWERCASE_UUID.test(value);
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ParseBotBookingRequestBodyResult<true> {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Unknown field",
      };
    }
  }
  return { ok: true, value: true };
}

function parseRequiredUuid(
  body: Record<string, unknown>,
  field: string,
): ParseBotBookingRequestBodyResult<string> {
  const raw = body[field];
  if (typeof raw !== "string" || !isCanonicalLowercaseUuid(raw)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: `Invalid ${field}`,
    };
  }
  return { ok: true, value: raw };
}

/**
 * Exact Content-Type: application/json (optional charset=utf-8).
 */
export function isExactApplicationJsonContentType(
  header: string | null,
): boolean {
  if (header == null) {
    return false;
  }
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return false;
  }

  const parts = header.split(";").slice(1);
  for (const part of parts) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "charset=utf-8" || trimmed === 'charset="utf-8"') {
      continue;
    }
    return false;
  }

  return true;
}

export function parseBotBookingRequestFeedBody(
  body: unknown,
): ParseBotBookingRequestBodyResult<BotBookingRequestFeedRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  const unknown = rejectUnknownFields(body, FEED_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  let limit = 20;
  if (body.limit !== undefined) {
    if (
      typeof body.limit !== "number" ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > 50
    ) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid limit",
      };
    }
    limit = body.limit;
  }

  if (body.cursor === undefined) {
    return { ok: true, value: { limit } };
  }

  if (!isPlainObject(body.cursor)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  const cursorKeys = Object.keys(body.cursor);
  if (
    cursorKeys.length !== 2 ||
    !cursorKeys.includes("createdAt") ||
    !cursorKeys.includes("id")
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  const createdAt = body.cursor.createdAt;
  const id = body.cursor.id;
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }
  if (typeof id !== "string" || !isCanonicalLowercaseUuid(id)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid cursor",
    };
  }

  return {
    ok: true,
    value: {
      limit,
      cursor: { createdAt, id },
    },
  };
}

export function parseBotBookingRequestGetBody(
  body: unknown,
): ParseBotBookingRequestBodyResult<BotBookingRequestGetRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }
  const unknown = rejectUnknownFields(body, GET_KEYS);
  if (!unknown.ok) {
    return unknown;
  }
  const id = parseRequiredUuid(body, "id");
  if (!id.ok) {
    return id;
  }
  return { ok: true, value: { id: id.value } };
}

export function parseBotBookingRequestAvailabilityBody(
  body: unknown,
): ParseBotBookingRequestBodyResult<BotBookingRequestAvailabilityRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }
  const unknown = rejectUnknownFields(body, AVAILABILITY_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const requestId = parseRequiredUuid(body, "requestId");
  if (!requestId.ok) {
    return requestId;
  }

  const hasDate = body.date !== undefined;
  const hasMonth = body.month !== undefined;
  if (hasDate === hasMonth) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  if (hasDate) {
    if (typeof body.date !== "string" || !isValidDateKey(body.date)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid date",
      };
    }
    return {
      ok: true,
      value: { requestId: requestId.value, date: body.date },
    };
  }

  if (typeof body.month !== "string" || !isValidMonthKey(body.month)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid month",
    };
  }
  return {
    ok: true,
    value: { requestId: requestId.value, month: body.month },
  };
}

export function parseBotBookingRequestAppointmentsLookupBody(
  body: unknown,
): ParseBotBookingRequestBodyResult<BotBookingRequestAppointmentsLookupRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }
  const unknown = rejectUnknownFields(body, LOOKUP_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const hasPhone = body.phone !== undefined;
  const hasClientId = body.clientId !== undefined;
  if (hasPhone === hasClientId) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  if (hasPhone) {
    if (
      typeof body.phone !== "string" ||
      !body.phone.trim() ||
      body.phone.length > 32
    ) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Invalid phone",
      };
    }
    return { ok: true, value: { phone: body.phone.trim() } };
  }

  const clientId = parseRequiredUuid(body, "clientId");
  if (!clientId.ok) {
    return clientId;
  }
  return { ok: true, value: { clientId: clientId.value } };
}

/**
 * Parse and validate studio-offset startsAt (`YYYY-MM-DDTHH:mm:00+05:00`).
 */
export function parseBotBookingRequestStartsAt(
  raw: string,
): ParseBotBookingRequestBodyResult<{
  startsAt: string;
  dateKey: string;
  startTime: string;
}> {
  const match = STUDIO_OFFSET_STARTS_AT.exec(raw);
  if (!match) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid startsAt",
    };
  }

  const dateKey = match[1]!;
  const startTime = `${match[2]}:${match[3]}`;
  if (!isValidDateKey(dateKey)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid startsAt",
    };
  }

  const canonical = formatStudioOffsetDateTime(dateKey, startTime);
  if (!canonical || canonical !== raw) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid startsAt",
    };
  }

  return {
    ok: true,
    value: { startsAt: canonical, dateKey, startTime },
  };
}

export function parseBotBookingRequestBookBody(
  body: unknown,
): ParseBotBookingRequestBodyResult<
  BotBookingRequestBookRequest & {
    dateKey: string;
    startTime: string;
  }
> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }
  const unknown = rejectUnknownFields(body, BOOK_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const requestId = parseRequiredUuid(body, "requestId");
  if (!requestId.ok) {
    return requestId;
  }

  const idempotencyKeyRaw = body.idempotencyKey;
  if (
    typeof idempotencyKeyRaw !== "string" ||
    !isCanonicalUuid(idempotencyKeyRaw) ||
    idempotencyKeyRaw !== idempotencyKeyRaw.toLowerCase() ||
    !isCanonicalLowercaseUuid(idempotencyKeyRaw)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid idempotencyKey",
    };
  }

  if (typeof body.startsAt !== "string") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid startsAt",
    };
  }
  const startsAt = parseBotBookingRequestStartsAt(body.startsAt);
  if (!startsAt.ok) {
    return startsAt;
  }

  let serviceId: string | undefined;
  if (body.serviceId !== undefined) {
    const parsed = parseRequiredUuid(body, "serviceId");
    if (!parsed.ok) {
      return parsed;
    }
    serviceId = parsed.value;
  }

  return {
    ok: true,
    value: {
      requestId: requestId.value,
      startsAt: startsAt.value.startsAt,
      idempotencyKey: idempotencyKeyRaw,
      ...(serviceId !== undefined ? { serviceId } : {}),
      dateKey: startsAt.value.dateKey,
      startTime: startsAt.value.startTime,
    },
  };
}

export function fixedBotBookingRequestErrorMessage(
  code: BotBookingRequestErrorCode,
): string {
  switch (code) {
    case "PAYLOAD_TOO_LARGE":
      return "Payload too large";
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "RATE_LIMITED":
      return "Rate limited";
    case "NOT_FOUND":
      return "Not found";
    case "BOOKING_REQUEST_INVALID":
      return "Booking request invalid";
    case "BOOKING_REQUEST_CONFLICT":
      return "Booking request conflict";
    case "CONSULTATION_SERVICE_REQUIRED":
      return "Consultation service required";
    case "SLOT_NO_LONGER_AVAILABLE":
      return "Slot no longer available";
    case "SERVICE_UNAVAILABLE":
      return "Service unavailable";
    case "MASTER_UNAVAILABLE":
      return "Master unavailable";
    case "SERVICE_MASTER_MISMATCH":
      return "Service and master mismatch";
    case "IDEMPOTENCY_CONFLICT":
      return "Idempotency conflict";
    case "IDEMPOTENCY_IN_PROGRESS":
      return "Idempotency in progress";
    case "RECONCILIATION_REQUIRED":
      return "Reconciliation required";
    case "BOOKING_CONFLICT":
      return "Booking conflict";
    case "INTERNAL_ERROR":
      return "Internal error";
    default:
      return "Invalid request";
  }
}

export function defaultBotBookingRequestHttpStatus(
  code: BotBookingRequestErrorCode,
): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "NOT_FOUND":
      return 404;
    case "IDEMPOTENCY_CONFLICT":
    case "IDEMPOTENCY_IN_PROGRESS":
    case "BOOKING_REQUEST_CONFLICT":
    case "SLOT_NO_LONGER_AVAILABLE":
    case "BOOKING_CONFLICT":
    case "RECONCILIATION_REQUIRED":
      return 409;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}
