/**
 * CURSOR-26 — Master Command API contracts (parse + error codes).
 * Validation errors never include name, phone, or body contents.
 */
import type { ScheduleBlockType } from "@prisma/client";
import { parseBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  isClientConsentGiven,
  validateClientContactFields,
} from "@/lib/booking/client-validation";
import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";
import { normalizeBookingClientName } from "@/lib/booking-requests/idempotency-server";
import {
  addDaysToDateKey,
  isValidDateKey,
} from "@/lib/datetime/date-layer";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export { isExactApplicationJsonContentType } from "@/lib/bot-api/booking-create-types";

/** Inclusive calendar-day span limit for schedule read. */
export const MASTER_SCHEDULE_MAX_RANGE_DAYS = 14;

export const MASTER_INTERVAL_BLOCK_TYPES = [
  "BREAK",
  "LUNCH",
  "PERSONAL",
  "DO_NOT_BOOK",
] as const satisfies readonly ScheduleBlockType[];

export const MASTER_FULL_DAY_BLOCK_TYPES = [
  "DAY_OFF",
  "VACATION",
  "SICK_LEAVE",
  "DO_NOT_BOOK",
] as const satisfies readonly ScheduleBlockType[];

export type MasterCommandErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "MASTER_NOT_FOUND"
  | "MASTER_SCOPE_VIOLATION"
  | "RANGE_TOO_LARGE"
  | "APPOINTMENT_CONFLICT"
  | "BLOCK_CONFLICT"
  | "BLOCK_NOT_FOUND"
  | "BLOCK_NOT_OWNED"
  | "EXTRA_WORK_NOT_FOUND"
  | "EXTRA_WORK_NOT_OWNED"
  | "EXTRA_WORK_IN_USE"
  | "SLOT_INVALID"
  | "SLOT_NO_LONGER_AVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "MASTER_UNAVAILABLE"
  | "SERVICE_MASTER_MISMATCH"
  | "CLIENT_AMBIGUOUS"
  | "INTERNAL_ERROR";

export type MasterCommandErrorBody = {
  ok: false;
  code: MasterCommandErrorCode;
  error: string;
};

export function masterCommandFixedErrorMessage(
  code: MasterCommandErrorCode,
): string {
  switch (code) {
    case "PAYLOAD_TOO_LARGE":
      return "Payload too large";
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "RATE_LIMITED":
      return "Too many requests";
    case "IDEMPOTENCY_CONFLICT":
      return "Idempotency conflict";
    case "IDEMPOTENCY_IN_PROGRESS":
      return "Idempotency in progress";
    case "MASTER_NOT_FOUND":
      return "Master not found";
    case "MASTER_SCOPE_VIOLATION":
      return "Master scope violation";
    case "RANGE_TOO_LARGE":
      return "Date range too large";
    case "APPOINTMENT_CONFLICT":
      return "Appointment conflict";
    case "BLOCK_CONFLICT":
      return "Block conflict";
    case "BLOCK_NOT_FOUND":
      return "Block not found";
    case "BLOCK_NOT_OWNED":
      return "Block not owned";
    case "EXTRA_WORK_NOT_FOUND":
      return "Extra work window not found";
    case "EXTRA_WORK_NOT_OWNED":
      return "Extra work window not owned";
    case "EXTRA_WORK_IN_USE":
      return "Extra work window in use";
    case "SLOT_INVALID":
      return "Invalid slot";
    case "SLOT_NO_LONGER_AVAILABLE":
      return "Slot no longer available";
    case "SERVICE_UNAVAILABLE":
      return "Service unavailable";
    case "MASTER_UNAVAILABLE":
      return "Master unavailable";
    case "SERVICE_MASTER_MISMATCH":
      return "Service and master mismatch";
    case "CLIENT_AMBIGUOUS":
      return "Client ambiguous";
    case "INTERNAL_ERROR":
      return "Internal error";
    default:
      return "Invalid request";
  }
}

export function masterCommandDefaultHttpStatus(
  code: MasterCommandErrorCode,
): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "IDEMPOTENCY_CONFLICT":
    case "IDEMPOTENCY_IN_PROGRESS":
    case "APPOINTMENT_CONFLICT":
    case "BLOCK_CONFLICT":
    case "EXTRA_WORK_IN_USE":
    case "SLOT_NO_LONGER_AVAILABLE":
    case "CLIENT_AMBIGUOUS":
      return 409;
    case "MASTER_NOT_FOUND":
    case "BLOCK_NOT_FOUND":
    case "EXTRA_WORK_NOT_FOUND":
      return 404;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
): string | null {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return "Unknown field";
    }
  }
  return null;
}

function parseMasterId(value: unknown): string | null {
  if (typeof value !== "string" || !isCanonicalUuid(value)) {
    return null;
  }
  return value;
}

function parseIdempotencyKey(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !isCanonicalUuid(value) ||
    value !== value.toLowerCase()
  ) {
    return null;
  }
  return value;
}

function parseTimeHHmm(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  if (hour > 23 || minute > 59) {
    return null;
  }
  return value;
}

function inclusiveDayCount(fromDateKey: string, toDateKey: string): number {
  let count = 0;
  let cursor = fromDateKey;
  while (cursor <= toDateKey && count <= MASTER_SCHEDULE_MAX_RANGE_DAYS + 1) {
    count += 1;
    cursor = addDaysToDateKey(cursor, 1);
  }
  return count;
}

export type MasterScheduleReadRequest = {
  masterId: string;
  fromDateKey: string;
  toDateKey: string;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

export function parseMasterScheduleReadBody(
  body: unknown,
): ParseResult<MasterScheduleReadRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set(["masterId", "fromDateKey", "toDateKey"]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.fromDateKey !== "string" || !isValidDateKey(body.fromDateKey)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid fromDateKey" };
  }
  if (typeof body.toDateKey !== "string" || !isValidDateKey(body.toDateKey)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid toDateKey" };
  }
  if (body.fromDateKey > body.toDateKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid date range" };
  }
  if (inclusiveDayCount(body.fromDateKey, body.toDateKey) > MASTER_SCHEDULE_MAX_RANGE_DAYS) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Date range too large" };
  }

  return {
    ok: true,
    value: {
      masterId,
      fromDateKey: body.fromDateKey,
      toDateKey: body.toDateKey,
    },
  };
}

export type MasterCloseIntervalRequest = {
  idempotencyKey: string;
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  blockType: (typeof MASTER_INTERVAL_BLOCK_TYPES)[number];
};

export function parseMasterCloseIntervalBody(
  body: unknown,
): ParseResult<MasterCloseIntervalRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set([
      "idempotencyKey",
      "masterId",
      "dateKey",
      "startTime",
      "endTime",
      "blockType",
    ]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.dateKey !== "string" || !isValidDateKey(body.dateKey)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid dateKey" };
  }
  const startTime = parseTimeHHmm(body.startTime);
  const endTime = parseTimeHHmm(body.endTime);
  if (!startTime || !endTime) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid time" };
  }
  if (
    typeof body.blockType !== "string" ||
    !(MASTER_INTERVAL_BLOCK_TYPES as readonly string[]).includes(body.blockType)
  ) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid blockType" };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      masterId,
      dateKey: body.dateKey,
      startTime,
      endTime,
      blockType: body.blockType as MasterCloseIntervalRequest["blockType"],
    },
  };
}

export type MasterCloseDayRequest = {
  idempotencyKey: string;
  masterId: string;
  dateKey: string;
  blockType: (typeof MASTER_FULL_DAY_BLOCK_TYPES)[number];
};

export function parseMasterCloseDayBody(
  body: unknown,
): ParseResult<MasterCloseDayRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set(["idempotencyKey", "masterId", "dateKey", "blockType"]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.dateKey !== "string" || !isValidDateKey(body.dateKey)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid dateKey" };
  }
  if (
    typeof body.blockType !== "string" ||
    !(MASTER_FULL_DAY_BLOCK_TYPES as readonly string[]).includes(body.blockType)
  ) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid blockType" };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      masterId,
      dateKey: body.dateKey,
      blockType: body.blockType as MasterCloseDayRequest["blockType"],
    },
  };
}

export type MasterDeleteBlockRequest = {
  idempotencyKey: string;
  masterId: string;
  blockId: string;
};

export function parseMasterDeleteBlockBody(
  body: unknown,
): ParseResult<MasterDeleteBlockRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set(["idempotencyKey", "masterId", "blockId"]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.blockId !== "string" || !isCanonicalUuid(body.blockId)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid blockId" };
  }

  return {
    ok: true,
    value: { idempotencyKey, masterId, blockId: body.blockId },
  };
}

export type MasterExtraWorkCreateRequest = {
  idempotencyKey: string;
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isOnlineBookingEnabled: boolean;
};

export function parseMasterExtraWorkCreateBody(
  body: unknown,
): ParseResult<MasterExtraWorkCreateRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set([
      "idempotencyKey",
      "masterId",
      "dateKey",
      "startTime",
      "endTime",
      "isOnlineBookingEnabled",
    ]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.dateKey !== "string" || !isValidDateKey(body.dateKey)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid dateKey" };
  }
  const startTime = parseTimeHHmm(body.startTime);
  const endTime = parseTimeHHmm(body.endTime);
  if (!startTime || !endTime) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid time" };
  }
  if (typeof body.isOnlineBookingEnabled !== "boolean") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid isOnlineBookingEnabled",
    };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      masterId,
      dateKey: body.dateKey,
      startTime,
      endTime,
      isOnlineBookingEnabled: body.isOnlineBookingEnabled,
    },
  };
}

export type MasterExtraWorkDeleteRequest = {
  idempotencyKey: string;
  masterId: string;
  extraWorkWindowId: string;
};

export function parseMasterExtraWorkDeleteBody(
  body: unknown,
): ParseResult<MasterExtraWorkDeleteRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set(["idempotencyKey", "masterId", "extraWorkWindowId"]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (
    typeof body.extraWorkWindowId !== "string" ||
    !isCanonicalUuid(body.extraWorkWindowId)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid extraWorkWindowId",
    };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      masterId,
      extraWorkWindowId: body.extraWorkWindowId,
    },
  };
}

export type MasterBookingCreateRequest = {
  idempotencyKey: string;
  masterId: string;
  slotId: string;
  clientName: string;
  phone: string;
  personalDataConsent: true;
  offerAcknowledgement: true;
};

export function parseMasterBookingCreateBody(
  body: unknown,
): ParseResult<MasterBookingCreateRequest> {
  if (!isPlainObject(body)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid request body" };
  }
  const unknown = rejectUnknownKeys(
    body,
    new Set([
      "idempotencyKey",
      "masterId",
      "slotId",
      "clientName",
      "phone",
      "personalDataConsent",
      "offerAcknowledgement",
    ]),
  );
  if (unknown) {
    return { ok: false, code: "VALIDATION_ERROR", error: unknown };
  }

  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid idempotencyKey" };
  }
  const masterId = parseMasterId(body.masterId);
  if (!masterId) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid masterId" };
  }
  if (typeof body.slotId !== "string") {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid slotId" };
  }
  const slotParsed = parseBotSlotId(body.slotId);
  if (!slotParsed.ok) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid slotId" };
  }
  if (slotParsed.value.masterId !== masterId) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Master scope mismatch",
    };
  }

  if (!isClientConsentGiven(body.personalDataConsent)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Consent required",
    };
  }
  if (!isClientConsentGiven(body.offerAcknowledgement)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Consent required",
    };
  }

  if (typeof body.clientName !== "string" || typeof body.phone !== "string") {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid contact" };
  }

  const clientName = normalizeBookingClientName(body.clientName);
  const phone = body.phone.trim();
  const fieldErrors = validateClientContactFields(clientName, phone);
  if (fieldErrors.name || fieldErrors.phone || !normalizePhone(phone)) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Invalid contact" };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      masterId,
      slotId: body.slotId,
      clientName,
      phone,
      personalDataConsent: true,
      offerAcknowledgement: true,
    },
  };
}
