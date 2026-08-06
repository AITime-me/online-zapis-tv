/**
 * Persistent idempotency helpers for internal bot booking create.
 * Server-only — keyed HMAC fingerprint, no raw PII persistence.
 */
import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  Prisma,
  type InternalBotBookingOperationState,
  type Prisma as PrismaNs,
} from "@prisma/client";
import type { BotBookingCreateSuccessBody } from "@/lib/bot-api/booking-create-types";
import {
  resolveBotIdempotencyHmacConfig,
  type BotIdempotencyHmacConfig,
} from "@/lib/bot-api/booking-create-idempotency-hmac";
import { normalizeBookingClientName } from "@/lib/booking-requests/idempotency-server";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export {
  BotIdempotencyHmacConfigError,
  BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE,
  resolveBotIdempotencyHmacConfig,
} from "@/lib/bot-api/booking-create-idempotency-hmac";

/** Domain-separated operation kind (includes version). */
export const BOT_BOOKING_OPERATION_KIND = "bot.booking.create.v1";

export const BOT_BOOKING_IDEMPOTENCY_LEASE_MS = 45_000;
export const BOT_BOOKING_IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type BotBookingFingerprintInput = {
  slotId: string;
  clientName: string;
  phone: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
};

/**
 * Canonical payload for HMAC (fixed key order, NFC names, normalized phone).
 * Must never be logged — contains normalized identifiers.
 */
function buildCanonicalFingerprintPayload(
  input: BotBookingFingerprintInput,
): string {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("BOT_BOOKING_FINGERPRINT_PHONE_INVALID");
  }

  const clientName = normalizeBookingClientName(input.clientName).normalize(
    "NFC",
  );
  const slotId = input.slotId.normalize("NFC");

  // Fixed key order — JSON object key insertion order is stable here.
  const ordered = {
    clientName,
    normalizedPhone,
    offerAcknowledgement: input.offerAcknowledgement === true,
    operationKind: BOT_BOOKING_OPERATION_KIND,
    personalDataConsent: input.personalDataConsent === true,
    slotId,
  };

  return JSON.stringify(ordered);
}

function hmacHex(secret: string, canonicalPayload: string): string {
  return createHmac("sha256", secret)
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

export function computeBotBookingRequestFingerprint(
  input: BotBookingFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const config = resolveBotIdempotencyHmacConfig(env);
  const canonical = buildCanonicalFingerprintPayload(input);
  return hmacHex(config.currentSecret, canonical);
}

/**
 * Current + previous fingerprints for rotation-safe equality checks.
 * New claims always persist the current fingerprint only.
 */
export function computeBotBookingRequestFingerprintCandidates(
  input: BotBookingFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): { current: string; candidates: string[] } {
  const config = resolveBotIdempotencyHmacConfig(env);
  return computeFingerprintCandidatesWithConfig(input, config);
}

function computeFingerprintCandidatesWithConfig(
  input: BotBookingFingerprintInput,
  config: BotIdempotencyHmacConfig,
): { current: string; candidates: string[] } {
  const canonical = buildCanonicalFingerprintPayload(input);
  const current = hmacHex(config.currentSecret, canonical);
  const previous = config.previousSecrets.map((secret) =>
    hmacHex(secret, canonical),
  );
  return { current, candidates: [current, ...previous] };
}

export function botBookingFingerprintsEqual(
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

export function botBookingFingerprintMatchesAny(
  persisted: string | null | undefined,
  candidates: string[],
): boolean {
  if (!persisted?.trim() || candidates.length === 0) {
    return false;
  }
  for (const candidate of candidates) {
    if (botBookingFingerprintsEqual(persisted, candidate)) {
      return true;
    }
  }
  return false;
}

export function createBotBookingLeaseOwner(): string {
  return randomBytes(16).toString("hex");
}

export type SafeBotBookingResultSnapshot = {
  bookingId: string;
  slotId: string;
  status: "SCHEDULED";
  startsAt: string;
};

export function buildSafeBotBookingResultSnapshot(input: {
  bookingId: string;
  slotId: string;
  startsAt: string;
}): SafeBotBookingResultSnapshot {
  return {
    bookingId: input.bookingId,
    slotId: input.slotId,
    status: "SCHEDULED",
    startsAt: input.startsAt,
  };
}

export function sanitizeBotBookingResultSnapshot(
  raw: unknown,
): SafeBotBookingResultSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    typeof row.bookingId !== "string" ||
    typeof row.slotId !== "string" ||
    row.status !== "SCHEDULED" ||
    typeof row.startsAt !== "string"
  ) {
    return null;
  }

  const allowed = new Set(["bookingId", "slotId", "status", "startsAt"]);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      return null;
    }
  }

  return {
    bookingId: row.bookingId,
    slotId: row.slotId,
    status: "SCHEDULED",
    startsAt: row.startsAt,
  };
}

export function toBotBookingSuccessBody(
  snapshot: SafeBotBookingResultSnapshot,
  idempotentReplay: boolean,
): BotBookingCreateSuccessBody {
  return {
    ok: true,
    bookingId: snapshot.bookingId,
    slotId: snapshot.slotId,
    status: "SCHEDULED",
    startsAt: snapshot.startsAt,
    idempotentReplay,
  };
}

export type ClaimBotBookingIdempotencyResult =
  | {
      kind: "claimed";
      operationId: string;
      leaseOwner: string;
      /** Fingerprint stored on the row (may be previous-secret until upgraded). */
      persistedFingerprint: string;
    }
  | {
      kind: "replay_success";
      snapshot: SafeBotBookingResultSnapshot;
    }
  | {
      kind: "replay_failure";
      code: string;
    }
  | { kind: "conflict" }
  | { kind: "in_progress" };

type IdempotencyDb = Pick<
  PrismaNs.TransactionClient,
  "internalBotBookingOperation"
>;

export async function claimBotBookingIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<ClaimBotBookingIdempotencyResult> {
  const now = input.now ?? new Date();
  const leaseOwner = createBotBookingLeaseOwner();
  const leaseExpiresAt = new Date(
    now.getTime() + BOT_BOOKING_IDEMPOTENCY_LEASE_MS,
  );
  const expiresAt = new Date(
    now.getTime() + BOT_BOOKING_IDEMPOTENCY_RETENTION_MS,
  );

  try {
    const created = await db.internalBotBookingOperation.create({
      data: {
        operationKind: BOT_BOOKING_OPERATION_KIND,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.fingerprint,
        state: "IN_PROGRESS",
        leaseOwner,
        leaseExpiresAt,
        attemptCount: 1,
        expiresAt,
      },
      select: { id: true, requestFingerprint: true },
    });

    return {
      kind: "claimed",
      operationId: created.id,
      leaseOwner,
      persistedFingerprint: created.requestFingerprint,
    };
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      )
    ) {
      throw error;
    }
  }

  const existing = await db.internalBotBookingOperation.findUnique({
    where: {
      operationKind_idempotencyKey: {
        operationKind: BOT_BOOKING_OPERATION_KIND,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (!existing) {
    return { kind: "in_progress" };
  }

  if (
    !botBookingFingerprintMatchesAny(
      existing.requestFingerprint,
      input.matchFingerprints,
    )
  ) {
    return { kind: "conflict" };
  }

  if (existing.state === "SUCCEEDED") {
    const snapshot = sanitizeBotBookingResultSnapshot(existing.resultSnapshot);
    if (!snapshot) {
      throw new Error("BOT_BOOKING_IDEMPOTENCY_SNAPSHOT_INVALID");
    }
    return { kind: "replay_success", snapshot };
  }

  if (existing.state === "FAILED_FINAL") {
    return {
      kind: "replay_failure",
      code: existing.failureCode ?? "INTERNAL_ERROR",
    };
  }

  const leaseExpired =
    !existing.leaseExpiresAt ||
    existing.leaseExpiresAt.getTime() <= now.getTime();

  if (
    (existing.state === "IN_PROGRESS" ||
      existing.state === "FAILED_RETRYABLE") &&
    leaseExpired
  ) {
    const updated = await db.internalBotBookingOperation.updateMany({
      where: {
        id: existing.id,
        state: { in: ["IN_PROGRESS", "FAILED_RETRYABLE"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        state: "IN_PROGRESS" satisfies InternalBotBookingOperationState,
        leaseOwner,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        failureCode: null,
        resultSnapshot: Prisma.DbNull,
      },
    });

    if (updated.count === 1) {
      return {
        kind: "claimed",
        operationId: existing.id,
        leaseOwner,
        persistedFingerprint: existing.requestFingerprint,
      };
    }
  }

  return { kind: "in_progress" };
}

export async function markBotBookingIdempotencyFailure(
  db: IdempotencyDb,
  input: {
    operationId: string;
    leaseOwner: string;
    fingerprint: string;
    state: "FAILED_RETRYABLE" | "FAILED_FINAL";
    failureCode: string;
  },
): Promise<void> {
  await db.internalBotBookingOperation.updateMany({
    where: {
      id: input.operationId,
      leaseOwner: input.leaseOwner,
      requestFingerprint: input.fingerprint,
      state: "IN_PROGRESS",
    },
    data: {
      state: input.state,
      failureCode: input.failureCode,
      leaseOwner: null,
      leaseExpiresAt:
        input.state === "FAILED_RETRYABLE"
          ? new Date(Date.now() + BOT_BOOKING_IDEMPOTENCY_LEASE_MS)
          : null,
      resultSnapshot: Prisma.DbNull,
    },
  });
}
