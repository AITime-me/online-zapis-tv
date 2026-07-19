/**
 * One open game booking request per normalized phone + GameCatalog.
 * Open = NEW | CONTACTED. CLOSED frees the phone for a new game lead.
 */
import type { BookingRequestStatus } from "@prisma/client";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export const OPEN_GAME_BOOKING_REQUEST_STATUSES = [
  "NEW",
  "CONTACTED",
] as const satisfies readonly BookingRequestStatus[];

export type OpenGameBookingRequestStatus =
  (typeof OPEN_GAME_BOOKING_REQUEST_STATUSES)[number];

/** Public-neutral: does not reveal whether conflict is visitor-local or phone-wide. */
export const GAME_OPEN_REQUEST_EXISTS_CODE = "GAME_BOOKING_ALREADY_SUBMITTED";

export const GAME_OPEN_REQUEST_EXISTS_MESSAGE =
  "Заявка по игре уже отправлена. Менеджер студии свяжется с вами.";

/** Migration-only partial unique index name (not expressible in Prisma schema). */
export const OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX =
  "booking_requests_open_game_phone_catalog_uidx";

export type BookingRequestUniqueViolationKind =
  | "idempotency_key"
  | "open_game_phone_catalog"
  | "other";

/**
 * How to handle a BookingRequest create P2002 after optional idempotency lookup.
 * - idempotent_retry: caller found matching idempotency row (handled outside)
 * - open_game_exists: return GAME_BOOKING_ALREADY_SUBMITTED
 * - rethrow: do not mask as a game business error
 */
export type GameBookingP2002Resolution =
  | { action: "open_game_exists" }
  | { action: "try_idempotent_retry" }
  | { action: "rethrow" }
  | { action: "requery_open_then_maybe_open_or_rethrow" };

export function isOpenGameBookingRequestStatus(
  status: string | null | undefined,
): status is OpenGameBookingRequestStatus {
  return status === "NEW" || status === "CONTACTED";
}

/**
 * Canonical phone key for the open-request unique index.
 * Returns null when the number cannot be normalized to a comparable form.
 */
export function normalizeGameBookingPhoneKey(
  phone: string | null | undefined,
): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 10) {
    return null;
  }
  return normalized;
}

function uniqueTargetParts(target: unknown): string[] {
  if (target == null) {
    return [];
  }
  if (Array.isArray(target)) {
    return target.map(String).map((part) => part.trim()).filter(Boolean);
  }
  const single = String(target).trim();
  return single ? [single] : [];
}

/** True when Prisma supplied a non-empty unique-target hint. */
export function hasReliableUniqueTargetMetadata(target: unknown): boolean {
  return uniqueTargetParts(target).length > 0;
}

export function isIdempotencyKeyConstraintTarget(target: unknown): boolean {
  const parts = uniqueTargetParts(target);
  if (parts.length === 0) {
    return false;
  }
  const joined = parts.join(",").toLowerCase();
  if (joined.includes("idempotency_key") || joined.includes("idempotencykey")) {
    return true;
  }
  // Single-field unique on idempotency_key only.
  return parts.length === 1 && /^idempotency_?key$/i.test(parts[0]!);
}

export function isOpenGamePhoneCatalogConstraintTarget(
  target: unknown,
): boolean {
  const parts = uniqueTargetParts(target);
  if (parts.length === 0) {
    return false;
  }

  const joined = parts.join(",").toLowerCase();
  if (joined.includes(OPEN_GAME_PHONE_CATALOG_UNIQUE_INDEX)) {
    return true;
  }

  const hasPhone = parts.some((part) =>
    /client_phone_normalized|clientphonenormalized/i.test(part),
  );
  const hasCatalog = parts.some((part) =>
    /game_catalog_id|gamecatalogid/i.test(part),
  );

  return hasPhone && hasCatalog;
}

export function classifyBookingRequestUniqueTarget(
  target: unknown,
): BookingRequestUniqueViolationKind {
  if (isOpenGamePhoneCatalogConstraintTarget(target)) {
    return "open_game_phone_catalog";
  }
  if (isIdempotencyKeyConstraintTarget(target)) {
    return "idempotency_key";
  }
  return "other";
}

/**
 * Decide next step for a P2002 on game booking create.
 * Does not perform DB I/O — caller runs idempotency lookup / open requery.
 */
export function resolveGameBookingCreateP2002Plan(
  target: unknown,
): GameBookingP2002Resolution {
  const kind = classifyBookingRequestUniqueTarget(target);

  if (kind === "open_game_phone_catalog") {
    return { action: "open_game_exists" };
  }

  if (kind === "idempotency_key") {
    return { action: "try_idempotent_retry" };
  }

  // Unreliable / missing target: may be phone race or unknown — requery open.
  if (!hasReliableUniqueTargetMetadata(target)) {
    return { action: "requery_open_then_maybe_open_or_rethrow" };
  }

  // Reliable but foreign unique (e.g. primary key / future constraint).
  return { action: "rethrow" };
}
