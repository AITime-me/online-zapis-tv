export const SITE_ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "source_marker",
] as const;

export type SiteAttributionKey = (typeof SITE_ATTRIBUTION_KEYS)[number];

export type SiteAttribution = Record<SiteAttributionKey, string | null>;

export const EMPTY_SITE_ATTRIBUTION: SiteAttribution = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  referrer: null,
  source_marker: null,
};

export const BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY =
  "booking-flow:site-attribution:v1";

const BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_VERSION = 1;

const VALUE_LIMITS: Record<SiteAttributionKey, number> = {
  utm_source: 256,
  utm_medium: 256,
  utm_campaign: 256,
  utm_content: 256,
  utm_term: 256,
  referrer: 2048,
  source_marker: 256,
};

const KEY_SET = new Set<string>(SITE_ATTRIBUTION_KEYS);

export type ParseSiteAttributionResult =
  | { ok: true; value: SiteAttribution }
  | { ok: false; error: "INVALID_ATTRIBUTION" };

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeReferrer(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (
    normalized.length > VALUE_LIMITS.referrer ||
    containsControlCharacter(normalized)
  ) {
    return undefined;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin.length <= VALUE_LIMITS.referrer ? url.origin : undefined;
  } catch {
    return null;
  }
}

function normalizeValue(
  value: unknown,
  key: SiteAttributionKey,
): string | null | undefined {
  if (key === "referrer") {
    return normalizeReferrer(value);
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (
    normalized.length > VALUE_LIMITS[key] ||
    containsControlCharacter(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeAttributionRecord(
  record: Record<string, unknown>,
  invalidValue: "null",
): SiteAttribution;
function normalizeAttributionRecord(
  record: Record<string, unknown>,
  invalidValue: "reject",
): SiteAttribution | null;
function normalizeAttributionRecord(
  record: Record<string, unknown>,
  invalidValue: "reject" | "null",
): SiteAttribution | null {
  const value = { ...EMPTY_SITE_ATTRIBUTION };
  for (const key of SITE_ATTRIBUTION_KEYS) {
    const normalized = normalizeValue(record[key], key);
    if (normalized === undefined && invalidValue === "reject") {
      return null;
    }
    value[key] = normalized === undefined ? null : normalized;
  }
  return value;
}

export function parseSiteAttribution(
  input: unknown,
): ParseSiteAttributionResult {
  if (input === undefined || input === null) {
    return { ok: true, value: { ...EMPTY_SITE_ATTRIBUTION } };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "INVALID_ATTRIBUTION" };
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEY_SET.has(key))) {
    return { ok: false, error: "INVALID_ATTRIBUTION" };
  }
  const value = normalizeAttributionRecord(record, "reject");
  return value
    ? { ok: true, value }
    : { ok: false, error: "INVALID_ATTRIBUTION" };
}

export function hasObservedSiteAttribution(
  value: SiteAttribution,
): boolean {
  return SITE_ATTRIBUTION_KEYS.some((key) => value[key] !== null);
}

export function captureSiteAttribution(
  searchParams: Pick<URLSearchParams, "get">,
  referrer: string | null | undefined,
): SiteAttribution {
  const observed: Record<SiteAttributionKey, unknown> = {
    utm_source: searchParams.get("utm_source"),
    utm_medium: searchParams.get("utm_medium"),
    utm_campaign: searchParams.get("utm_campaign"),
    utm_content: searchParams.get("utm_content"),
    utm_term: searchParams.get("utm_term"),
    referrer: referrer ?? null,
    // Query values are observable metadata, never trusted acquisition proof.
    // Only booking route handlers may add a server-verified source marker.
    source_marker: null,
  };
  return normalizeAttributionRecord(observed, "null");
}

function parseStoredBookingFlowAttribution(
  raw: string,
): SiteAttribution | null {
  try {
    const stored = JSON.parse(raw) as unknown;
    if (
      typeof stored !== "object" ||
      stored === null ||
      Array.isArray(stored) ||
      (stored as Record<string, unknown>).version !==
        BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_VERSION
    ) {
      return null;
    }
    const parsed = parseSiteAttribution(
      (stored as Record<string, unknown>).attribution,
    );
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export function getOrCreateBookingFlowSiteAttribution(
  storage: SessionStorageLike,
  searchParams: Pick<URLSearchParams, "get">,
  referrer: string | null | undefined,
): SiteAttribution {
  try {
    const raw = storage.getItem(BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY);
    if (raw !== null) {
      const restored = parseStoredBookingFlowAttribution(raw);
      if (restored) {
        return restored;
      }
    }
  } catch {
    // Storage may be unavailable; capture still remains valid for this mount.
  }

  const captured = captureSiteAttribution(searchParams, referrer);
  try {
    storage.setItem(
      BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY,
      JSON.stringify({
        version: BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_VERSION,
        attribution: captured,
      }),
    );
  } catch {
    // Do not fail booking when sessionStorage is unavailable or full.
  }
  return captured;
}

export function clearBookingFlowSiteAttribution(
  storage: SessionStorageLike,
): void {
  try {
    storage.removeItem(BOOKING_FLOW_SITE_ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Successful booking/request completion must not be turned into an error.
  }
}
