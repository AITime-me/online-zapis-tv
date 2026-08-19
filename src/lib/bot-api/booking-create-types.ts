/**
 * Exact request/response contracts for POST /api/internal/bot/v1/bookings.
 * Validation error strings never include name, phone, or body contents.
 */

import { parseBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  isClientConsentGiven,
  validateClientContactFields,
} from "@/lib/booking/client-validation";
import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";
import { normalizeBookingClientName } from "@/lib/booking-requests/idempotency-server";
import { normalizePhone } from "@/lib/phone/normalize-phone";

const ALLOWED_BODY_KEYS = new Set([
  "idempotencyKey",
  "slotId",
  "clientName",
  "phone",
  "clientRef",
  "personalDataConsent",
  "offerAcknowledgement",
]);

export type BotBookingCreateRequest = {
  idempotencyKey: string;
  slotId: string;
  clientName: string;
  phone: string;
  /**
   * Bot-TV canonical identity (UUID string).
   * When present, it becomes authoritative cross-system identity.
   */
  clientRef?: string;
  personalDataConsent: true;
  offerAcknowledgement: true;
};

export type BotBookingCreateSuccessBody = {
  ok: true;
  bookingId: string;
  slotId: string;
  status: "SCHEDULED";
  startsAt: string;
  idempotentReplay: boolean;
};

export type BotBookingCreateErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "SLOT_INVALID"
  | "SLOT_NO_LONGER_AVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "MASTER_UNAVAILABLE"
  | "SERVICE_MASTER_MISMATCH"
  | "CLIENT_AMBIGUOUS"
  | "BOOKING_REQUEST_INVALID"
  | "BOOKING_REQUEST_CONFLICT"
  | "BOOKING_CONFLICT"
  | "INTERNAL_ERROR";

export type BotBookingCreateErrorBody = {
  ok: false;
  code: BotBookingCreateErrorCode;
  error: string;
};

export type ParseBotBookingCreateBodyResult =
  | { ok: true; value: BotBookingCreateRequest }
  | { ok: false; code: "VALIDATION_ERROR"; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBotBookingCreateBody(
  body: unknown,
): ParseBotBookingCreateBodyResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        error: "Unknown field",
      };
    }
  }

  const idempotencyKeyRaw = body.idempotencyKey;
  if (
    typeof idempotencyKeyRaw !== "string" ||
    !isCanonicalUuid(idempotencyKeyRaw) ||
    idempotencyKeyRaw !== idempotencyKeyRaw.toLowerCase()
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid idempotencyKey",
    };
  }

  if (typeof body.slotId !== "string") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid slotId",
    };
  }

  const slotParsed = parseBotSlotId(body.slotId);
  if (!slotParsed.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid slotId",
    };
  }

  if (typeof body.clientName !== "string" || !body.clientName.trim()) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid clientName",
    };
  }

  const clientName = normalizeBookingClientName(body.clientName);

  if (typeof body.phone !== "string" || !body.phone.trim()) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid phone",
    };
  }

  const phone = body.phone.trim();

  const clientRefRaw = (body as Record<string, unknown>).clientRef;
  const clientRef =
    clientRefRaw === undefined
      ? undefined
      : typeof clientRefRaw !== "string"
        ? null
        : clientRefRaw.trim();

  if (clientRef === null || clientRef === "") {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid clientRef",
    };
  }

  if (clientRef !== undefined && !isCanonicalUuid(clientRef)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid clientRef",
    };
  }

  const fieldErrors = validateClientContactFields(clientName, phone);
  if (fieldErrors.name) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid clientName",
    };
  }
  if (fieldErrors.phone || !normalizePhone(phone)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid phone",
    };
  }

  if (body.personalDataConsent !== true) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid personalDataConsent",
    };
  }

  if (body.offerAcknowledgement !== true) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid offerAcknowledgement",
    };
  }

  // Exact true already checked; keep isClientConsentGiven for consistency.
  if (
    !isClientConsentGiven(body.personalDataConsent) ||
    !isClientConsentGiven(body.offerAcknowledgement)
  ) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request body",
    };
  }

  return {
    ok: true,
    value: {
      idempotencyKey: idempotencyKeyRaw,
      slotId: body.slotId,
      clientName,
      phone,
      ...(clientRef !== undefined ? { clientRef: clientRef.toLowerCase() } : {}),
      personalDataConsent: true,
      offerAcknowledgement: true,
    },
  };
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
