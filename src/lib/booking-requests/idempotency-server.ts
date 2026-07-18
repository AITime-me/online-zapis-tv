/**
 * Server-only booking idempotency HMAC helpers.
 * Do not import from client components.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BookingRequestType } from "@prisma/client";
import { normalizePhone } from "@/lib/phone/normalize-phone";

const DEV_FALLBACK_SECRET = "dev-idempotency-hmac-not-for-production";

function resolveHmacSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "";

  if (secret.length >= 16) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    return "production-idempotency-hmac-fallback";
  }

  return DEV_FALLBACK_SECRET;
}

export type BookingIdempotencyPayload = {
  clientName: string;
  clientPhone: string;
  type: BookingRequestType;
  comment: string | null;
  masterId: string | null;
  serviceId: string | null;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  gamePlayId: string | null;
  gameSessionId: string | null;
};

export function normalizeBookingClientName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeBookingClientPhone(phone: string): string {
  return normalizePhone(phone) ?? phone.trim();
}

export function buildBookingIdempotencyPayload(input: {
  clientName: string;
  clientPhone: string;
  type: BookingRequestType;
  comment: string | null;
  masterId: string | null;
  serviceId?: string | null;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  gamePlayId: string | null;
  gameSessionId: string | null;
}): BookingIdempotencyPayload {
  return {
    clientName: normalizeBookingClientName(input.clientName),
    clientPhone: normalizeBookingClientPhone(input.clientPhone),
    type: input.type,
    comment: input.comment?.trim() || null,
    masterId: input.masterId?.trim() || null,
    serviceId: input.serviceId?.trim() || null,
    personalDataConsent: input.personalDataConsent === true,
    offerAcknowledgement: input.offerAcknowledgement === true,
    gamePlayId: input.gamePlayId?.trim() || null,
    gameSessionId: input.gameSessionId?.trim() || null,
  };
}

function canonicalizePayload(payload: BookingIdempotencyPayload): string {
  const ordered: Record<string, string | boolean | null> = {
    clientName: payload.clientName,
    clientPhone: payload.clientPhone,
    comment: payload.comment,
    gamePlayId: payload.gamePlayId,
    gameSessionId: payload.gameSessionId,
    masterId: payload.masterId,
    offerAcknowledgement: payload.offerAcknowledgement,
    personalDataConsent: payload.personalDataConsent,
    serviceId: payload.serviceId,
    type: payload.type,
  };

  return JSON.stringify(ordered);
}

export function computeIdempotencyPayloadHash(
  payload: BookingIdempotencyPayload,
): string {
  const canonical = canonicalizePayload(payload);
  return createHmac("sha256", resolveHmacSecret())
    .update(canonical, "utf8")
    .digest("hex");
}

export function idempotencyPayloadHashesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";

  if (!a || !b || a.length !== b.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}
