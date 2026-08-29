/**
 * BOT-CONTROL-PLANE-05 — LIVE business facts runtime contract (schema v1).
 *
 * This is NOT managed KB and NOT a publication snapshot.
 * It exposes current authoritative structured business Source of Truth only.
 *
 * ## Fact ownership (runtime invariant)
 *
 * LIVE FACTS wins over published KB prose for:
 * - price (priceFrom / priceTo)
 * - durationMinutes
 * - master ↔ service assignment (MasterService)
 * - booking capability / bookingMode
 * - active / inactive state
 * - current structured studio contact + isOnlineBookingEnabled
 *
 * Published KB may explain a procedure, but must not override these values.
 * Availability (dates/slots/blocks) stays on request-time booking APIs —
 * never cached inside this payload.
 *
 * Promotions/gifts are intentionally omitted from v1 (split-brain gap).
 */

import type { BookingServiceMode } from "@/lib/booking/catalog-types";

export const BOT_LIVE_FACTS_SCHEMA_VERSION = 1 as const;

export const BOT_LIVE_FACTS_CURRENCY = "RUB" as const;

/** Runtime invariant string — asserted by security checks. */
export const BOT_LIVE_FACTS_OWNERSHIP_INVARIANT =
  "LIVE_FACTS_WINS_OVER_KB_PROSE_FOR_PRICE_DURATION_MASTER_ASSIGNMENT_BOOKING_MODE_ACTIVE_STATE_STUDIO_STRUCTURED";

export const BOT_LIVE_FACTS_AVAILABILITY_BOUNDARY =
  "LIVE_FACTS_EXCLUDES_AVAILABILITY_SLOTS_DATES_BLOCKS_APPOINTMENT_STATE";

export const BOT_LIVE_FACTS_PROMOTIONS_GAP =
  "PROMOTIONS_GIFTS_OMITTED_V1_SPLIT_BRAIN_PROMO_RULES_VS_DB_PROMOTIONS";

const MAX_SAFE_STRING = 500;
const MAX_SAFE_LONG_STRING = 1000;

export type BotLiveFactsStudioV1 = {
  name: string;
  phone: string;
  email: string;
  address: string;
  workingHoursText: string;
  isOnlineBookingEnabled: boolean;
};

export type BotLiveFactsServiceV1 = {
  id: string;
  name: string;
  category: string | null;
  priceFrom: string | null;
  priceTo: string | null;
  currency: typeof BOT_LIVE_FACTS_CURRENCY;
  durationMinutes: number;
  bookingMode: BookingServiceMode;
  isActive: boolean;
  isOnlineBookingEnabled: boolean;
};

export type BotLiveFactsMasterV1 = {
  id: string;
  name: string;
  isActive: boolean;
  isOnlineBookingEnabled: boolean;
  /** Enabled MasterService rows only; empty when no authoritative links. */
  serviceIds: string[];
};

export type BotLiveFactsPayloadV1 = {
  schemaVersion: typeof BOT_LIVE_FACTS_SCHEMA_VERSION;
  generatedAt: string;
  studio: BotLiveFactsStudioV1;
  services: BotLiveFactsServiceV1[];
  masters: BotLiveFactsMasterV1[];
};

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "generatedAt",
  "studio",
  "services",
  "masters",
] as const;

const STUDIO_KEYS = [
  "name",
  "phone",
  "email",
  "address",
  "workingHoursText",
  "isOnlineBookingEnabled",
] as const;

const SERVICE_KEYS = [
  "id",
  "name",
  "category",
  "priceFrom",
  "priceTo",
  "currency",
  "durationMinutes",
  "bookingMode",
  "isActive",
  "isOnlineBookingEnabled",
] as const;

const MASTER_KEYS = [
  "id",
  "name",
  "isActive",
  "isOnlineBookingEnabled",
  "serviceIds",
] as const;

const FORBIDDEN_PAYLOAD_KEYS = [
  "slots",
  "availableDays",
  "availability",
  "scheduleBlocks",
  "appointments",
  "appointmentState",
  "promotions",
  "gifts",
  "discounts",
  "priceLabel",
  "internalName",
  "clientDescription",
  "updatedByUserId",
  "publishedByUserId",
  "apiKey",
  "token",
  "secret",
  "password",
  "authorization",
  "botKnowledge",
  "botSettings",
] as const;

const AVAILABILITY_FORBIDDEN_KEYS = [
  "slots",
  "availableDays",
  "availability",
  "scheduleBlocks",
  "appointments",
  "appointmentState",
] as const;

export class BotLiveFactsPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotLiveFactsPayloadError";
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    throw new BotLiveFactsPayloadError(`${label}: unexpected keys`);
  }
}

function boundSafeString(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return trimmed.slice(0, max);
}

function assertSafeBoundedString(
  value: unknown,
  max: number,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new BotLiveFactsPayloadError(`${label}: expected string`);
  }
  if (value.length > max) {
    throw new BotLiveFactsPayloadError(`${label}: exceeds max length`);
  }
  return value;
}

function assertIsoTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new BotLiveFactsPayloadError("generatedAt: invalid");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new BotLiveFactsPayloadError("generatedAt: invalid ISO timestamp");
  }
  return value;
}

function assertDecimalStringOrNull(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new BotLiveFactsPayloadError(`${label}: expected canonical decimal string|null`);
  }
  return value;
}

function assertUuid(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BotLiveFactsPayloadError(`${label}: expected uuid`);
  }
  return value;
}

function assertBookingMode(value: unknown): BookingServiceMode {
  if (value === "ONLINE" || value === "MANAGER_ONLY") {
    return value;
  }
  throw new BotLiveFactsPayloadError("bookingMode: invalid");
}

function assertNoForbiddenKeys(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoForbiddenKeys(entry);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new BotLiveFactsPayloadError(`forbidden key: ${key}`);
    }
    assertNoForbiddenKeys(entry);
  }
}

/**
 * Serialize Decimal-like values without floating-point money.
 * Accepts Prisma.Decimal (toString) or already-canonical strings.
 */
export function canonicalDecimalString(
  value: { toString(): string } | string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const raw = typeof value === "string" ? value.trim() : value.toString().trim();
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new BotLiveFactsPayloadError("price: non-canonical decimal");
  }
  return raw;
}

export function boundStudioField(value: string, kind: "short" | "long"): string {
  return boundSafeString(value, kind === "short" ? MAX_SAFE_STRING : MAX_SAFE_LONG_STRING);
}

export type BotLiveFactsServiceInput = {
  id: string;
  name: string;
  category: string | null;
  priceFrom: { toString(): string } | string | null;
  priceTo: { toString(): string } | string | null;
  durationMinutes: number;
  bookingMode: BookingServiceMode;
  isActive: boolean;
  isOnlineBookingEnabled: boolean;
  sortOrder: number;
};

export type BotLiveFactsMasterInput = {
  id: string;
  name: string;
  isActive: boolean;
  isOnlineBookingEnabled: boolean;
  sortOrder: number;
  /** Authoritative enabled MasterService.serviceId values only. */
  serviceIds: string[];
};

export type BotLiveFactsStudioInput = {
  name: string;
  phone: string;
  email: string;
  address: string;
  workingHoursText: string;
  isOnlineBookingEnabled: boolean;
};

export type BuildBotLiveFactsPayloadInput = {
  generatedAt: Date | string;
  studio: BotLiveFactsStudioInput;
  services: BotLiveFactsServiceInput[];
  masters: BotLiveFactsMasterInput[];
};

function compareServices(a: BotLiveFactsServiceInput, b: BotLiveFactsServiceInput): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  const byName = a.name.localeCompare(b.name, "ru");
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

function compareMasters(a: BotLiveFactsMasterInput, b: BotLiveFactsMasterInput): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  const byName = a.name.localeCompare(b.name, "ru");
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Build a strict schemaVersion=1 payload from already-fetched SOT rows.
 * No Prisma objects leak; ordering is deterministic.
 */
export function buildBotLiveFactsPayloadV1(
  input: BuildBotLiveFactsPayloadInput,
): BotLiveFactsPayloadV1 {
  const generatedAt =
    typeof input.generatedAt === "string"
      ? assertIsoTimestamp(input.generatedAt)
      : input.generatedAt.toISOString();

  const studio: BotLiveFactsStudioV1 = {
    name: boundStudioField(input.studio.name, "short"),
    phone: boundStudioField(input.studio.phone, "short"),
    email: boundStudioField(input.studio.email, "short"),
    address: boundStudioField(input.studio.address, "long"),
    workingHoursText: boundStudioField(input.studio.workingHoursText, "long"),
    isOnlineBookingEnabled: input.studio.isOnlineBookingEnabled === true,
  };

  const services = [...input.services].sort(compareServices).map((service) => {
    if (
      !Number.isInteger(service.durationMinutes) ||
      service.durationMinutes <= 0 ||
      service.durationMinutes > 24 * 60
    ) {
      throw new BotLiveFactsPayloadError("durationMinutes: out of range");
    }
    const row: BotLiveFactsServiceV1 = {
      id: assertUuid(service.id, "service.id"),
      name: boundStudioField(service.name, "short"),
      category:
        service.category == null
          ? null
          : boundStudioField(service.category, "short"),
      priceFrom: canonicalDecimalString(service.priceFrom),
      priceTo: canonicalDecimalString(service.priceTo),
      currency: BOT_LIVE_FACTS_CURRENCY,
      durationMinutes: service.durationMinutes,
      bookingMode: assertBookingMode(service.bookingMode),
      isActive: service.isActive === true,
      isOnlineBookingEnabled: service.isOnlineBookingEnabled === true,
    };
    return row;
  });

  const masters = [...input.masters].sort(compareMasters).map((master) => {
    const uniqueIds = [...new Set(master.serviceIds.map((id) => assertUuid(id, "serviceIds")))];
    uniqueIds.sort((a, b) => a.localeCompare(b));
    const row: BotLiveFactsMasterV1 = {
      id: assertUuid(master.id, "master.id"),
      name: boundStudioField(master.name, "short"),
      isActive: master.isActive === true,
      isOnlineBookingEnabled: master.isOnlineBookingEnabled === true,
      serviceIds: uniqueIds,
    };
    return row;
  });

  const payload: BotLiveFactsPayloadV1 = {
    schemaVersion: BOT_LIVE_FACTS_SCHEMA_VERSION,
    generatedAt,
    studio,
    services,
    masters,
  };

  assertValidBotLiveFactsPayloadV1(payload);
  return payload;
}

export function assertValidBotLiveFactsPayloadV1(
  payload: BotLiveFactsPayloadV1,
): void {
  assertNoForbiddenKeys(payload);
  assertExactKeys(
    payload as unknown as Record<string, unknown>,
    TOP_LEVEL_KEYS,
    "payload",
  );

  if (payload.schemaVersion !== BOT_LIVE_FACTS_SCHEMA_VERSION) {
    throw new BotLiveFactsPayloadError("schemaVersion must be 1");
  }
  assertIsoTimestamp(payload.generatedAt);

  assertExactKeys(
    payload.studio as unknown as Record<string, unknown>,
    STUDIO_KEYS,
    "studio",
  );
  assertSafeBoundedString(payload.studio.name, MAX_SAFE_STRING, "studio.name");
  assertSafeBoundedString(payload.studio.phone, MAX_SAFE_STRING, "studio.phone");
  assertSafeBoundedString(payload.studio.email, MAX_SAFE_STRING, "studio.email");
  assertSafeBoundedString(
    payload.studio.address,
    MAX_SAFE_LONG_STRING,
    "studio.address",
  );
  assertSafeBoundedString(
    payload.studio.workingHoursText,
    MAX_SAFE_LONG_STRING,
    "studio.workingHoursText",
  );
  if (typeof payload.studio.isOnlineBookingEnabled !== "boolean") {
    throw new BotLiveFactsPayloadError("studio.isOnlineBookingEnabled");
  }

  if (!Array.isArray(payload.services) || !Array.isArray(payload.masters)) {
    throw new BotLiveFactsPayloadError("services/masters must be arrays");
  }

  for (const service of payload.services) {
    assertExactKeys(
      service as unknown as Record<string, unknown>,
      SERVICE_KEYS,
      "service",
    );
    assertUuid(service.id, "service.id");
    assertSafeBoundedString(service.name, MAX_SAFE_STRING, "service.name");
    if (service.category !== null) {
      assertSafeBoundedString(service.category, MAX_SAFE_STRING, "service.category");
    }
    assertDecimalStringOrNull(service.priceFrom, "priceFrom");
    assertDecimalStringOrNull(service.priceTo, "priceTo");
    if (service.currency !== BOT_LIVE_FACTS_CURRENCY) {
      throw new BotLiveFactsPayloadError("currency");
    }
    assertBookingMode(service.bookingMode);
  }

  for (const master of payload.masters) {
    assertExactKeys(
      master as unknown as Record<string, unknown>,
      MASTER_KEYS,
      "master",
    );
    assertUuid(master.id, "master.id");
    assertSafeBoundedString(master.name, MAX_SAFE_STRING, "master.name");
    if (!Array.isArray(master.serviceIds)) {
      throw new BotLiveFactsPayloadError("serviceIds");
    }
    for (const serviceId of master.serviceIds) {
      assertUuid(serviceId, "master.serviceIds");
    }
  }

  for (const key of AVAILABILITY_FORBIDDEN_KEYS) {
    if (key in (payload as unknown as Record<string, unknown>)) {
      throw new BotLiveFactsPayloadError(`availability leak: ${key}`);
    }
  }
}
