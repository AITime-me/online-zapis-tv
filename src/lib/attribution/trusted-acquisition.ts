import type { SiteAttribution } from "@/lib/attribution/site-attribution";
import { isPlausibleOpaqueToken } from "@/lib/security/opaque-token-format";

export const ACQUISITION_SOURCE_KEYS = [
  "VK_ADS",
  "VK_CONTENT",
  "YANDEX",
  "TWO_GIS",
] as const;

export type AcquisitionSourceKey = (typeof ACQUISITION_SOURCE_KEYS)[number];

export const ACQUISITION_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const ACQUISITION_EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const ACQUISITION_BOOKING_PATHNAME = "/booking";
export const ACQUISITION_EVIDENCE_FRAGMENT_KEY = "acq";

export const BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY =
  "booking-flow:acquisition-evidence:v1";

const BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_VERSION = 1;

const SOURCE_KEY_SET = new Set<string>(ACQUISITION_SOURCE_KEYS);

const ALLOWED_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

/** Max length for a mint-time acquisition marketing identifier. */
export const ACQUISITION_MARKETING_ID_MAX_LENGTH = 64;

/**
 * Conservative marketing identifier: lowercase ASCII letters/digits with
 * optional `_` / `-` / `.`. The raw supplied value must already match —
 * no trim / case / PII sanitization into a valid id.
 */
const ACQUISITION_MARKETING_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Digit-only or phone-like (digits + common separators, optional leading +). */
const ACQUISITION_PHONE_LIKE_RE = /^\+?[0-9().\s-]+$/;

export type AcquisitionUtmFields = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export class AcquisitionAttributionValidationError extends Error {}

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function requireAcquisitionSourceKey(
  value: unknown,
): AcquisitionSourceKey {
  if (typeof value !== "string" || !SOURCE_KEY_SET.has(value)) {
    throw new AcquisitionAttributionValidationError(
      "Недопустимый источник привлечения",
    );
  }
  return value as AcquisitionSourceKey;
}

function isPhoneOrDigitCustomerIdentifier(value: string): boolean {
  if (/^\d+$/.test(value)) {
    return true;
  }
  if (!ACQUISITION_PHONE_LIKE_RE.test(value)) {
    return false;
  }
  const digitsOnly = value.replace(/^\+/, "").replace(/[().\s-]/g, "");
  return digitsOnly.length > 0 && /^\d+$/.test(digitsOnly);
}

/**
 * Canonical validator for acquisition-link UTM VALUES (mint boundary only).
 * Returns the raw accepted marketing id, or null only when the value is
 * absent (`null` / `undefined`). Explicit "" and whitespace are rejected.
 * Never silently trims, lowercases, or sanitizes PII into an accepted id.
 */
export function requireAcquisitionMarketingIdentifier(
  value: unknown,
  fieldName: string,
): string | null {
  // Absent optional value only. Explicit "" is rejected (no sanitization).
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AcquisitionAttributionValidationError(
      `Некорректное значение ${fieldName}`,
    );
  }

  if (
    value.length === 0 ||
    value.length > ACQUISITION_MARKETING_ID_MAX_LENGTH ||
    /[\s]/.test(value) ||
    /[@+/?#=%<>"'\\]/.test(value) ||
    value.includes("://") ||
    /%[0-9a-fA-F]{2}/.test(value) ||
    /[^\x20-\x7e]/.test(value) ||
    isPhoneOrDigitCustomerIdentifier(value) ||
    /^vk\d+$/i.test(value) ||
    !ACQUISITION_MARKETING_ID_RE.test(value)
  ) {
    throw new AcquisitionAttributionValidationError(
      `Недопустимый маркетинговый идентификатор ${fieldName}`,
    );
  }

  return value;
}

/**
 * Strict allowlist of UTM field names + marketing-identifier grammar for values.
 * Rejects arbitrary targetPath / fragment / unknown params / PII-like values.
 */
export function parseAcquisitionLinkUtmInput(
  input: Record<string, unknown> | null | undefined,
): AcquisitionUtmFields {
  if (input) {
    for (const key of Object.keys(input)) {
      if (!(ALLOWED_UTM_KEYS as readonly string[]).includes(key)) {
        throw new AcquisitionAttributionValidationError(
          "Разрешены только UTM-параметры привлечения",
        );
      }
    }
  }

  return {
    utm_source: requireAcquisitionMarketingIdentifier(
      input?.utm_source,
      "utm_source",
    ),
    utm_medium: requireAcquisitionMarketingIdentifier(
      input?.utm_medium,
      "utm_medium",
    ),
    utm_campaign: requireAcquisitionMarketingIdentifier(
      input?.utm_campaign,
      "utm_campaign",
    ),
    utm_content: requireAcquisitionMarketingIdentifier(
      input?.utm_content,
      "utm_content",
    ),
    utm_term: requireAcquisitionMarketingIdentifier(
      input?.utm_term,
      "utm_term",
    ),
  };
}

export function buildAcquisitionBookingRedirectPath(input: {
  utm: AcquisitionUtmFields;
  evidenceToken: string;
}): string {
  if (!isPlausibleOpaqueToken(input.evidenceToken)) {
    throw new AcquisitionAttributionValidationError(
      "Некорректный evidence-токен",
    );
  }

  const url = new URL(ACQUISITION_BOOKING_PATHNAME, "https://acquisition.invalid");
  for (const key of ALLOWED_UTM_KEYS) {
    const value = input.utm[key];
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  url.hash = `${ACQUISITION_EVIDENCE_FRAGMENT_KEY}=${input.evidenceToken}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Observed client attribution never carries trusted acquisition proof.
 * Server claim inside the conversion transaction is the only source of marker.
 */
export function discardClientSourceMarker(
  observed: SiteAttribution,
): SiteAttribution {
  return {
    ...observed,
    source_marker: null,
  };
}

export function applyTrustedSourceMarker(
  observed: SiteAttribution,
  sourceKey: AcquisitionSourceKey | null,
): SiteAttribution {
  return {
    ...discardClientSourceMarker(observed),
    source_marker: sourceKey,
  };
}

export function readAcquisitionEvidenceTokenFromHash(
  hash: string | null | undefined,
): string | null {
  if (!hash) {
    return null;
  }
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return null;
  }
  const params = new URLSearchParams(normalized);
  const token = params.get(ACQUISITION_EVIDENCE_FRAGMENT_KEY);
  if (!token || !isPlausibleOpaqueToken(token)) {
    return null;
  }
  return token;
}

export function stripAcquisitionEvidenceFromHash(
  hash: string | null | undefined,
): string {
  if (!hash) {
    return "";
  }
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return "";
  }
  const params = new URLSearchParams(normalized);
  params.delete(ACQUISITION_EVIDENCE_FRAGMENT_KEY);
  const remaining = params.toString();
  return remaining ? `#${remaining}` : "";
}

function parseStoredEvidenceToken(raw: string): string | null {
  try {
    const stored = JSON.parse(raw) as unknown;
    if (
      typeof stored !== "object" ||
      stored === null ||
      Array.isArray(stored) ||
      (stored as Record<string, unknown>).version !==
        BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_VERSION
    ) {
      return null;
    }
    const token = (stored as Record<string, unknown>).token;
    if (typeof token !== "string" || !isPlausibleOpaqueToken(token)) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * sessionStorage holds only the opaque bearer. First token for this tab/flow wins.
 * Not a trust boundary — server claim remains mandatory.
 */
export function getOrCreateBookingFlowAcquisitionEvidence(
  storage: SessionStorageLike,
  hash: string | null | undefined,
): string | null {
  try {
    const raw = storage.getItem(BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY);
    if (raw !== null) {
      const restored = parseStoredEvidenceToken(raw);
      if (restored) {
        return restored;
      }
    }
  } catch {
    // Storage may be unavailable.
  }

  const captured = readAcquisitionEvidenceTokenFromHash(hash);
  if (!captured) {
    return null;
  }

  try {
    storage.setItem(
      BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY,
      JSON.stringify({
        version: BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_VERSION,
        token: captured,
      }),
    );
  } catch {
    // Do not fail booking when sessionStorage is unavailable or full.
  }
  return captured;
}

export function clearBookingFlowAcquisitionEvidence(
  storage: SessionStorageLike,
): void {
  try {
    storage.removeItem(BOOKING_FLOW_ACQUISITION_EVIDENCE_STORAGE_KEY);
  } catch {
    // Successful conversion must not become an error.
  }
}

export function normalizeAcquisitionEvidenceTokenInput(
  value: unknown,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !isPlausibleOpaqueToken(value)) {
    return null;
  }
  return value;
}
