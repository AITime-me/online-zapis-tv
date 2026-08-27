/**
 * Server-only booking idempotency HMAC helpers.
 * Do not import from client components.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BookingRequestType } from "@prisma/client";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import {
  hasObservedSiteAttribution,
  type SiteAttribution,
} from "@/lib/attribution/site-attribution";
import {
  hashOpaqueToken,
  isPlausibleOpaqueToken,
} from "@/lib/security/opaque-token";

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
  attribution?: SiteAttribution;
  /** Stable SHA-256 of the opaque evidence bearer when supplied. */
  acquisitionEvidenceTokenHash?: string;
};

export function normalizeBookingClientName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeBookingClientPhone(phone: string): string {
  return normalizePhone(phone) ?? phone.trim();
}

export function fingerprintAcquisitionEvidenceToken(
  token: string | null | undefined,
): string | undefined {
  if (!token || !isPlausibleOpaqueToken(token)) {
    return undefined;
  }
  return hashOpaqueToken(token);
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
  attribution?: SiteAttribution;
  acquisitionEvidenceToken?: string | null;
}): BookingIdempotencyPayload {
  // Client source_marker is never part of trusted identity.
  const observedAttribution = input.attribution
    ? { ...input.attribution, source_marker: null }
    : undefined;
  const attribution =
    observedAttribution && hasObservedSiteAttribution(observedAttribution)
      ? observedAttribution
      : undefined;
  const acquisitionEvidenceTokenHash = fingerprintAcquisitionEvidenceToken(
    input.acquisitionEvidenceToken,
  );
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
    ...(attribution ? { attribution } : {}),
    ...(acquisitionEvidenceTokenHash
      ? { acquisitionEvidenceTokenHash }
      : {}),
  };
}

function canonicalizePayload(payload: BookingIdempotencyPayload): string {
  const ordered: Record<string, unknown> = {
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
  if (payload.attribution) {
    // Legacy A2.3a canonical form always included source_marker (null when
    // untrusted). Omitting it breaks bare replay against pre-A2.3b1 rows.
    ordered.attribution = {
      utm_source: payload.attribution.utm_source,
      utm_medium: payload.attribution.utm_medium,
      utm_campaign: payload.attribution.utm_campaign,
      utm_content: payload.attribution.utm_content,
      utm_term: payload.attribution.utm_term,
      referrer: payload.attribution.referrer,
      source_marker: payload.attribution.source_marker,
    };
  }
  if (payload.acquisitionEvidenceTokenHash) {
    ordered.acquisitionEvidenceTokenHash =
      payload.acquisitionEvidenceTokenHash;
  }

  return JSON.stringify(ordered);
}

/** Exported for fixed legacy fingerprint vector proofs only. */
export function canonicalizeBookingIdempotencyPayloadForTests(
  payload: BookingIdempotencyPayload,
): string {
  return canonicalizePayload(payload);
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
