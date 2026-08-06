import "server-only";

import { NextResponse } from "next/server";
import {
  ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_CODE,
} from "@/lib/booking/public-booking-errors";
import { buildBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  formatStudioOffsetDateTime,
  isValidDateKey,
  isValidMonthKey,
} from "@/lib/datetime/date-layer";
import { safeLogError } from "@/lib/logging/redact";
import type {
  BotAvailabilityErrorBody,
  BotAvailabilitySlotDto,
  BotAvailableDaysRequest,
  BotAvailableDaysSuccess,
  BotSlotsRequest,
  BotSlotsSuccess,
} from "@/lib/bot-api/availability-types";
import { AppointmentValidationError } from "@/services/AppointmentService";
import {
  getAvailableDaysInMonth,
  getAvailableTimeSlots,
  OnlineServiceUnavailableError,
  type PublicSlotCalculationOptions,
} from "@/services/BookingService";

/** Conservative hard cap: one calendar month cannot exceed 31 days. */
export const BOT_INTERNAL_MAX_AVAILABLE_DATE_KEYS = 31;

/** Conservative hard cap: 24h × 12 five-minute grid steps. */
export const BOT_INTERNAL_MAX_AVAILABLE_SLOTS = 288;

const CANONICAL_LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export { buildBotSlotId, parseBotSlotId } from "@/lib/booking/bot-slot-id";

const STRICT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const AVAILABLE_DAYS_BODY_KEYS = new Set(["serviceId", "masterId", "month"]);
const SLOTS_BODY_KEYS = new Set(["serviceId", "masterId", "date"]);

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

export type ParseBotAvailabilityBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

export type BotAvailabilityDomainResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "SERVICE_UNAVAILABLE" }
  | { ok: false; code: "INTERNAL_ERROR" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact canonical lowercase UUID — rejects uppercase, trim spaces, and noncanonical forms. */
export function isCanonicalLowercaseUuid(value: string): boolean {
  return value.length === 36 && CANONICAL_LOWERCASE_UUID.test(value);
}

function parseRequiredCanonicalUuid(
  body: Record<string, unknown>,
  field: "serviceId" | "masterId",
): ParseBotAvailabilityBodyResult<string> {
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

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): ParseBotAvailabilityBodyResult<true> {
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

export function parseBotAvailableDaysBody(
  body: unknown,
): ParseBotAvailabilityBodyResult<BotAvailableDaysRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  const unknown = rejectUnknownFields(body, AVAILABLE_DAYS_BODY_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const serviceId = parseRequiredCanonicalUuid(body, "serviceId");
  if (!serviceId.ok) {
    return serviceId;
  }

  const masterId = parseRequiredCanonicalUuid(body, "masterId");
  if (!masterId.ok) {
    return masterId;
  }

  const month = body.month;
  if (typeof month !== "string" || !isValidMonthKey(month)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid month",
    };
  }

  return {
    ok: true,
    value: {
      serviceId: serviceId.value,
      masterId: masterId.value,
      month,
    },
  };
}

export function parseBotSlotsBody(
  body: unknown,
): ParseBotAvailabilityBodyResult<BotSlotsRequest> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  const unknown = rejectUnknownFields(body, SLOTS_BODY_KEYS);
  if (!unknown.ok) {
    return unknown;
  }

  const serviceId = parseRequiredCanonicalUuid(body, "serviceId");
  if (!serviceId.ok) {
    return serviceId;
  }

  const masterId = parseRequiredCanonicalUuid(body, "masterId");
  if (!masterId.ok) {
    return masterId;
  }

  const date = body.date;
  if (typeof date !== "string" || !isValidDateKey(date)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid date",
    };
  }

  return {
    ok: true,
    value: {
      serviceId: serviceId.value,
      masterId: masterId.value,
      date,
    },
  };
}

function isStrictStudioTime(value: string): boolean {
  return STRICT_TIME_PATTERN.test(value);
}

/**
 * Validate and project BookingService day keys. Fail closed on duplicates,
 * invalid keys, unsorted invariant breaks, or hard-limit overflow.
 */
export function projectBotAvailableDays(input: {
  serviceId: string;
  masterId: string;
  month: string;
  studioToday: string;
  dateKeys: string[];
}): BotAvailabilityDomainResult<BotAvailableDaysSuccess> {
  if (!Array.isArray(input.dateKeys)) {
    return { ok: false, code: "INTERNAL_ERROR" };
  }

  if (input.dateKeys.length > BOT_INTERNAL_MAX_AVAILABLE_DATE_KEYS) {
    return { ok: false, code: "INTERNAL_ERROR" };
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const dateKey of input.dateKeys) {
    if (typeof dateKey !== "string" || !isValidDateKey(dateKey)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    if (seen.has(dateKey)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    seen.add(dateKey);
    unique.push(dateKey);
  }

  unique.sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    value: {
      ok: true,
      serviceId: input.serviceId,
      masterId: input.masterId,
      month: input.month,
      studioToday: input.studioToday,
      dateKeys: unique,
    },
  };
}

/**
 * Project only times returned by BookingService into minimal slot DTOs.
 * Does not invent slots. Fail closed on invalid/duplicate/overflow results.
 */
export function projectBotAvailableSlots(input: {
  serviceId: string;
  masterId: string;
  dateKey: string;
  studioToday: string;
  times: string[];
}): BotAvailabilityDomainResult<BotSlotsSuccess> {
  if (!Array.isArray(input.times)) {
    return { ok: false, code: "INTERNAL_ERROR" };
  }

  if (input.times.length > BOT_INTERNAL_MAX_AVAILABLE_SLOTS) {
    return { ok: false, code: "INTERNAL_ERROR" };
  }

  const seenTimes = new Set<string>();
  const seenSlotIds = new Set<string>();
  const slots: BotAvailabilitySlotDto[] = [];

  for (const startTime of input.times) {
    if (typeof startTime !== "string" || !isStrictStudioTime(startTime)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    if (seenTimes.has(startTime)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    seenTimes.add(startTime);

    const startsAt = formatStudioOffsetDateTime(input.dateKey, startTime);
    if (!startsAt) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }

    const slotId = buildBotSlotId({
      serviceId: input.serviceId,
      masterId: input.masterId,
      dateKey: input.dateKey,
      startTime,
    });

    if (seenSlotIds.has(slotId)) {
      return { ok: false, code: "INTERNAL_ERROR" };
    }
    seenSlotIds.add(slotId);

    slots.push({
      slotId,
      serviceId: input.serviceId,
      masterId: input.masterId,
      startsAt,
    });
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    ok: true,
    value: {
      ok: true,
      serviceId: input.serviceId,
      masterId: input.masterId,
      date: input.dateKey,
      studioToday: input.studioToday,
      slots,
    },
  };
}

export type BotAvailableDaysDeps = {
  getAvailableDaysInMonth?: typeof getAvailableDaysInMonth;
  slotOptions?: PublicSlotCalculationOptions;
};

export type BotSlotsDeps = {
  getAvailableTimeSlots?: typeof getAvailableTimeSlots;
  slotOptions?: PublicSlotCalculationOptions;
};

export async function evaluateBotAvailableDays(
  request: BotAvailableDaysRequest,
  studioToday: string,
  now: Date,
  deps: BotAvailableDaysDeps = {},
): Promise<BotAvailabilityDomainResult<BotAvailableDaysSuccess>> {
  const getDays = deps.getAvailableDaysInMonth ?? getAvailableDaysInMonth;

  try {
    const dateKeys = await getDays(
      request.masterId,
      request.serviceId,
      request.month,
      studioToday,
      {
        ...(deps.slotOptions ?? {}),
        now,
      },
    );

    return projectBotAvailableDays({
      serviceId: request.serviceId,
      masterId: request.masterId,
      month: request.month,
      studioToday,
      dateKeys,
    });
  } catch (error) {
    return mapOrRethrowDomainError(error);
  }
}

export async function evaluateBotAvailableSlots(
  request: BotSlotsRequest,
  studioToday: string,
  now: Date,
  deps: BotSlotsDeps = {},
): Promise<BotAvailabilityDomainResult<BotSlotsSuccess>> {
  const getSlots = deps.getAvailableTimeSlots ?? getAvailableTimeSlots;

  try {
    const times = await getSlots(
      request.masterId,
      request.serviceId,
      request.date,
      studioToday,
      {
        ...(deps.slotOptions ?? {}),
        now,
      },
    );

    return projectBotAvailableSlots({
      serviceId: request.serviceId,
      masterId: request.masterId,
      dateKey: request.date,
      studioToday,
      times,
    });
  } catch (error) {
    return mapOrRethrowDomainError(error);
  }
}

function mapOrRethrowDomainError(
  error: unknown,
): BotAvailabilityDomainResult<never> {
  // Expected online self-booking unavailability — stable non-200 SERVICE_UNAVAILABLE.
  // Includes master/link/timing AppointmentValidationError from assertOnlineBookable
  // so responses do not distinguish closed master vs closed service.
  if (
    error instanceof OnlineServiceUnavailableError ||
    error instanceof AppointmentValidationError
  ) {
    return { ok: false, code: "SERVICE_UNAVAILABLE" };
  }

  throw error;
}

export function botAvailabilityValidationResponse(
  error: string,
  status = 400,
): NextResponse {
  const body: BotAvailabilityErrorBody = {
    ok: false,
    code: status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
    error,
  };
  return NextResponse.json(body, { status, headers: JSON_HEADERS });
}

/**
 * HTTP status for SERVICE_UNAVAILABLE matches public availability
 * (`mapPublicAvailabilityError` → 400) and booking-create disabled-state contract.
 */
export const BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS = 400;

export function botAvailabilityServiceUnavailableResponse(): NextResponse {
  const body: BotAvailabilityErrorBody = {
    ok: false,
    code: SERVICE_UNAVAILABLE_CODE,
    error: ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
  };
  return NextResponse.json(body, {
    status: BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS,
    headers: JSON_HEADERS,
  });
}

export function botAvailabilityInternalErrorResponse(
  scope: string,
  error?: unknown,
): NextResponse {
  if (error !== undefined) {
    safeLogError(scope, error);
  } else {
    safeLogError(scope, new Error("internal invariant failure"));
  }

  const body: BotAvailabilityErrorBody = {
    ok: false,
    code: "INTERNAL_ERROR",
    error: "Internal error",
  };
  return NextResponse.json(body, { status: 500, headers: JSON_HEADERS });
}

export function botAvailabilitySuccessResponse<T extends object>(
  value: T,
): NextResponse {
  return NextResponse.json(value, { status: 200, headers: JSON_HEADERS });
}

export function mapBotAvailabilityDomainResult<T extends object>(
  scope: string,
  result: BotAvailabilityDomainResult<T>,
): NextResponse {
  if (result.ok) {
    return botAvailabilitySuccessResponse(result.value);
  }

  if (result.code === "SERVICE_UNAVAILABLE") {
    return botAvailabilityServiceUnavailableResponse();
  }

  return botAvailabilityInternalErrorResponse(scope);
}
