/**
 * Persistent idempotency helpers for internal bot booking create.
 * Server-only — keyed HMAC fingerprint, no raw PII persistence.
 */
import "server-only";

import type { Prisma as PrismaNs } from "@prisma/client";
import type { BotBookingCreateSuccessBody } from "@/lib/bot-api/booking-create-types";
import {
  claimInternalBotOperationIdempotency,
  computeInternalBotFingerprintCandidates,
  createInternalBotLeaseOwner,
  internalBotFingerprintMatchesAny,
  internalBotFingerprintsEqual,
  markInternalBotOperationIdempotencyFailure,
  type ClaimInternalBotOperationIdempotencyResult,
} from "@/lib/bot-api/internal-bot-operation-idempotency";
import { normalizeBookingClientName } from "@/lib/booking-requests/idempotency-server";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export {
  BotIdempotencyHmacConfigError,
  BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE,
  resolveBotIdempotencyHmacConfig,
} from "@/lib/bot-api/booking-create-idempotency-hmac";

/** Domain-separated operation kind (includes version). */
export const BOT_BOOKING_OPERATION_KIND = "bot.booking.create.v1";

export {
  INTERNAL_BOT_OPERATION_IDEMPOTENCY_LEASE_MS as BOT_BOOKING_IDEMPOTENCY_LEASE_MS,
  INTERNAL_BOT_OPERATION_IDEMPOTENCY_RETENTION_MS as BOT_BOOKING_IDEMPOTENCY_RETENTION_MS,
} from "@/lib/bot-api/internal-bot-operation-idempotency";

export type BotBookingFingerprintInput = {
  slotId: string;
  clientName: string;
  phone: string;
  /**
   * Bot-TV canonical identity UUID string.
   * When present, it is part of the HMAC fingerprint payload.
   */
  clientRef?: string;
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
  const ordered: {
    clientName: string;
    normalizedPhone: string;
    offerAcknowledgement: boolean;
    operationKind: string;
    personalDataConsent: boolean;
    slotId: string;
    clientRef?: string;
  } = {
    clientName,
    normalizedPhone,
    offerAcknowledgement: input.offerAcknowledgement === true,
    operationKind: BOT_BOOKING_OPERATION_KIND,
    personalDataConsent: input.personalDataConsent === true,
    slotId,
  };

  // Preserve legacy byte-for-byte: when clientRef is absent, do not add the key.
  if (input.clientRef !== undefined) {
    ordered.clientRef = input.clientRef.toLowerCase();
  }

  return JSON.stringify(ordered);
}

export function computeBotBookingRequestFingerprint(
  input: BotBookingFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return computeInternalBotFingerprintCandidates(
    buildCanonicalFingerprintPayload(input),
    env,
  ).current;
}

/**
 * Current + previous fingerprints for rotation-safe equality checks.
 * New claims always persist the current fingerprint only.
 */
export function computeBotBookingRequestFingerprintCandidates(
  input: BotBookingFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): { current: string; candidates: string[] } {
  return computeInternalBotFingerprintCandidates(
    buildCanonicalFingerprintPayload(input),
    env,
  );
}

export const botBookingFingerprintsEqual = internalBotFingerprintsEqual;
export const botBookingFingerprintMatchesAny = internalBotFingerprintMatchesAny;
export const createBotBookingLeaseOwner = createInternalBotLeaseOwner;

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

function mapClaimResult(
  result: ClaimInternalBotOperationIdempotencyResult,
): ClaimBotBookingIdempotencyResult {
  if (result.kind === "replay_success") {
    const snapshot = sanitizeBotBookingResultSnapshot(result.snapshot);
    if (!snapshot) {
      throw new Error("BOT_BOOKING_IDEMPOTENCY_SNAPSHOT_INVALID");
    }
    return { kind: "replay_success", snapshot };
  }
  return result;
}

export async function claimBotBookingIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<ClaimBotBookingIdempotencyResult> {
  try {
    const result = await claimInternalBotOperationIdempotency(db, {
      operationKind: BOT_BOOKING_OPERATION_KIND,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
      matchFingerprints: input.matchFingerprints,
      now: input.now,
      sanitizeSnapshot: sanitizeBotBookingResultSnapshot,
    });
    return mapClaimResult(result);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "INTERNAL_BOT_OPERATION_IDEMPOTENCY_SNAPSHOT_INVALID"
    ) {
      throw new Error("BOT_BOOKING_IDEMPOTENCY_SNAPSHOT_INVALID");
    }
    throw error;
  }
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
  await markInternalBotOperationIdempotencyFailure(db, input);
}
