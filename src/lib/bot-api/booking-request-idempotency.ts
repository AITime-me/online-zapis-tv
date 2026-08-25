/**
 * Idempotency for booking_request_book (InternalBotBookingOperation).
 * HMAC fingerprints only — never persist phone / name / raw PII.
 */
import "server-only";

import type { Prisma as PrismaNs } from "@prisma/client";
import type { BotBookingRequestBookSuccess } from "@/lib/bot-api/booking-request-types";
import {
  claimInternalBotOperationIdempotency,
  computeInternalBotFingerprintCandidates,
  markInternalBotOperationIdempotencyFailure,
  type ClaimInternalBotOperationIdempotencyResult,
} from "@/lib/bot-api/internal-bot-operation-idempotency";

/** Spec operation kind for InternalBotBookingOperation. */
export const BOOKING_REQUEST_BOOK_OPERATION_KIND = "booking_request_book";

export type BookingRequestBookFingerprintInput = {
  requestId: string;
  startsAt: string;
  /** Body serviceId when provided; empty string when absent. */
  serviceId: string;
};

export type SafeBookingRequestBookResultSnapshot = {
  appointmentId: string;
  requestId: string;
  status: "CLOSED";
  startsAt: string;
  serviceId: string;
  masterId: string;
};

type IdempotencyDb = Pick<
  PrismaNs.TransactionClient,
  "internalBotBookingOperation"
>;

function buildCanonicalFingerprintPayload(
  input: BookingRequestBookFingerprintInput,
): string {
  return JSON.stringify({
    operationKind: BOOKING_REQUEST_BOOK_OPERATION_KIND,
    requestId: input.requestId,
    serviceId: input.serviceId,
    startsAt: input.startsAt,
  });
}

export function computeBookingRequestBookFingerprintCandidates(
  input: BookingRequestBookFingerprintInput,
  env: NodeJS.ProcessEnv = process.env,
): { current: string; candidates: string[] } {
  return computeInternalBotFingerprintCandidates(
    buildCanonicalFingerprintPayload(input),
    env,
  );
}

export function buildSafeBookingRequestBookResultSnapshot(input: {
  appointmentId: string;
  requestId: string;
  startsAt: string;
  serviceId: string;
  masterId: string;
}): SafeBookingRequestBookResultSnapshot {
  return {
    appointmentId: input.appointmentId,
    requestId: input.requestId,
    status: "CLOSED",
    startsAt: input.startsAt,
    serviceId: input.serviceId,
    masterId: input.masterId,
  };
}

export function sanitizeBookingRequestBookResultSnapshot(
  raw: unknown,
): SafeBookingRequestBookResultSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const allowed = new Set([
    "appointmentId",
    "requestId",
    "status",
    "startsAt",
    "serviceId",
    "masterId",
  ]);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      return null;
    }
  }
  if (
    typeof row.appointmentId !== "string" ||
    typeof row.requestId !== "string" ||
    row.status !== "CLOSED" ||
    typeof row.startsAt !== "string" ||
    typeof row.serviceId !== "string" ||
    typeof row.masterId !== "string"
  ) {
    return null;
  }
  return {
    appointmentId: row.appointmentId,
    requestId: row.requestId,
    status: "CLOSED",
    startsAt: row.startsAt,
    serviceId: row.serviceId,
    masterId: row.masterId,
  };
}

export function toBookingRequestBookSuccessBody(
  snapshot: SafeBookingRequestBookResultSnapshot,
  idempotentReplay: boolean,
): BotBookingRequestBookSuccess {
  return {
    ok: true,
    appointmentId: snapshot.appointmentId,
    requestId: snapshot.requestId,
    status: "CLOSED",
    startsAt: snapshot.startsAt,
    serviceId: snapshot.serviceId,
    masterId: snapshot.masterId,
    idempotentReplay,
  };
}

export type ClaimBookingRequestBookIdempotencyResult =
  | {
      kind: "claimed";
      operationId: string;
      leaseOwner: string;
      persistedFingerprint: string;
    }
  | {
      kind: "replay_success";
      snapshot: SafeBookingRequestBookResultSnapshot;
    }
  | { kind: "replay_failure"; code: string }
  | { kind: "conflict" }
  | { kind: "in_progress" };

function mapClaimResult(
  result: ClaimInternalBotOperationIdempotencyResult,
): ClaimBookingRequestBookIdempotencyResult {
  if (result.kind === "replay_success") {
    const snapshot = sanitizeBookingRequestBookResultSnapshot(result.snapshot);
    if (!snapshot) {
      throw new Error("BOOKING_REQUEST_BOOK_IDEMPOTENCY_SNAPSHOT_INVALID");
    }
    return { kind: "replay_success", snapshot };
  }
  if (result.kind === "claimed") {
    return {
      kind: "claimed",
      operationId: result.operationId,
      leaseOwner: result.leaseOwner,
      persistedFingerprint: result.persistedFingerprint,
    };
  }
  if (result.kind === "replay_failure") {
    return { kind: "replay_failure", code: result.code };
  }
  return { kind: result.kind };
}

export async function claimBookingRequestBookIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<ClaimBookingRequestBookIdempotencyResult> {
  const result = await claimInternalBotOperationIdempotency(db, {
    operationKind: BOOKING_REQUEST_BOOK_OPERATION_KIND,
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    matchFingerprints: input.matchFingerprints,
    now: input.now,
    sanitizeSnapshot: sanitizeBookingRequestBookResultSnapshot,
  });
  return mapClaimResult(result);
}

export async function markBookingRequestBookIdempotencyFailure(
  db: IdempotencyDb,
  input: {
    operationId: string;
    leaseOwner: string;
    fingerprint: string;
    state: "FAILED_FINAL" | "FAILED_RETRYABLE";
    failureCode: string;
  },
): Promise<void> {
  await markInternalBotOperationIdempotencyFailure(db, {
    operationId: input.operationId,
    leaseOwner: input.leaseOwner,
    fingerprint: input.fingerprint,
    state: input.state,
    failureCode: input.failureCode,
  });
}
