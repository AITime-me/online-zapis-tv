/**
 * Idempotency fingerprints + snapshots for CURSOR-26 master commands.
 * Never store phone / manage tokens / raw PII in snapshots.
 */
import "server-only";

import type { Prisma as PrismaNs } from "@prisma/client";
import {
  claimInternalBotOperationIdempotency,
  computeInternalBotFingerprintCandidates,
  markInternalBotOperationIdempotencyFailure,
  type ClaimInternalBotOperationIdempotencyResult,
} from "@/lib/bot-api/internal-bot-operation-idempotency";
import { normalizeBookingClientName } from "@/lib/booking-requests/idempotency-server";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export const MASTER_OP_CLOSE_INTERVAL = "bot.master.block.close-interval.v1";
export const MASTER_OP_CLOSE_DAY = "bot.master.block.close-day.v1";
export const MASTER_OP_DELETE_BLOCK = "bot.master.block.delete.v1";
export const MASTER_OP_EXTRA_WORK_CREATE = "bot.master.extra-work.create.v1";
export const MASTER_OP_EXTRA_WORK_DELETE = "bot.master.extra-work.delete.v1";
export const MASTER_OP_BOOKING_CREATE = "bot.master.booking.create.v1";

type IdempotencyDb = Pick<
  PrismaNs.TransactionClient,
  "internalBotBookingOperation"
>;

function fingerprintFromOrdered(ordered: Record<string, unknown>): {
  current: string;
  candidates: string[];
} {
  return computeInternalBotFingerprintCandidates(JSON.stringify(ordered));
}

export function computeMasterCloseIntervalFingerprint(input: {
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  blockType: string;
}): { current: string; candidates: string[] } {
  return fingerprintFromOrdered({
    blockType: input.blockType,
    dateKey: input.dateKey,
    endTime: input.endTime,
    masterId: input.masterId,
    operationKind: MASTER_OP_CLOSE_INTERVAL,
    startTime: input.startTime,
  });
}

export function computeMasterCloseDayFingerprint(input: {
  masterId: string;
  dateKey: string;
  blockType: string;
}): { current: string; candidates: string[] } {
  return fingerprintFromOrdered({
    blockType: input.blockType,
    dateKey: input.dateKey,
    masterId: input.masterId,
    operationKind: MASTER_OP_CLOSE_DAY,
  });
}

export function computeMasterDeleteBlockFingerprint(input: {
  masterId: string;
  blockId: string;
}): { current: string; candidates: string[] } {
  return fingerprintFromOrdered({
    blockId: input.blockId,
    masterId: input.masterId,
    operationKind: MASTER_OP_DELETE_BLOCK,
  });
}

export function computeMasterExtraWorkCreateFingerprint(input: {
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isOnlineBookingEnabled: boolean;
}): { current: string; candidates: string[] } {
  return fingerprintFromOrdered({
    dateKey: input.dateKey,
    endTime: input.endTime,
    isOnlineBookingEnabled: input.isOnlineBookingEnabled === true,
    masterId: input.masterId,
    operationKind: MASTER_OP_EXTRA_WORK_CREATE,
    startTime: input.startTime,
  });
}

export function computeMasterExtraWorkDeleteFingerprint(input: {
  masterId: string;
  extraWorkWindowId: string;
}): { current: string; candidates: string[] } {
  return fingerprintFromOrdered({
    extraWorkWindowId: input.extraWorkWindowId,
    masterId: input.masterId,
    operationKind: MASTER_OP_EXTRA_WORK_DELETE,
  });
}

export function computeMasterBookingCreateFingerprint(input: {
  masterId: string;
  slotId: string;
  clientName: string;
  phone: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
}): { current: string; candidates: string[] } {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("MASTER_BOOKING_FINGERPRINT_PHONE_INVALID");
  }
  return fingerprintFromOrdered({
    clientName: normalizeBookingClientName(input.clientName).normalize("NFC"),
    masterId: input.masterId,
    normalizedPhone,
    offerAcknowledgement: input.offerAcknowledgement === true,
    operationKind: MASTER_OP_BOOKING_CREATE,
    personalDataConsent: input.personalDataConsent === true,
    slotId: input.slotId.normalize("NFC"),
  });
}

export type SafeMasterBlockSnapshot = {
  blockId: string;
  masterId: string;
  dateKey: string;
  isFullDay: boolean;
  blockType: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type SafeMasterDeleteSnapshot = {
  blockId: string;
  masterId: string;
  deleted: true;
};

export type SafeMasterExtraWorkSnapshot = {
  extraWorkWindowId: string;
  masterId: string;
  dateKey: string;
  startsAt: string;
  endsAt: string;
  isOnlineBookingEnabled: boolean;
};

export type SafeMasterExtraWorkDeleteSnapshot = {
  extraWorkWindowId: string;
  masterId: string;
  deleted: true;
};

export type SafeMasterBookingSnapshot = {
  bookingId: string;
  slotId: string;
  masterId: string;
  status: "SCHEDULED";
  startsAt: string;
};

function sanitizeObject(
  raw: unknown,
  required: Record<string, (v: unknown) => boolean>,
): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const allowed = new Set(Object.keys(required));
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) return null;
  }
  for (const [key, check] of Object.entries(required)) {
    if (!check(row[key])) return null;
  }
  return row;
}

export function sanitizeMasterBlockSnapshot(
  raw: unknown,
): SafeMasterBlockSnapshot | null {
  const row = sanitizeObject(raw, {
    blockId: (v) => typeof v === "string",
    masterId: (v) => typeof v === "string",
    dateKey: (v) => typeof v === "string",
    isFullDay: (v) => typeof v === "boolean",
    blockType: (v) => typeof v === "string",
    startsAt: (v) => v === null || typeof v === "string",
    endsAt: (v) => v === null || typeof v === "string",
  });
  if (!row) return null;
  return row as unknown as SafeMasterBlockSnapshot;
}

export function sanitizeMasterDeleteSnapshot(
  raw: unknown,
): SafeMasterDeleteSnapshot | null {
  const row = sanitizeObject(raw, {
    blockId: (v) => typeof v === "string",
    masterId: (v) => typeof v === "string",
    deleted: (v) => v === true,
  });
  if (!row) return null;
  return row as unknown as SafeMasterDeleteSnapshot;
}

export function sanitizeMasterExtraWorkSnapshot(
  raw: unknown,
): SafeMasterExtraWorkSnapshot | null {
  const row = sanitizeObject(raw, {
    extraWorkWindowId: (v) => typeof v === "string",
    masterId: (v) => typeof v === "string",
    dateKey: (v) => typeof v === "string",
    startsAt: (v) => typeof v === "string",
    endsAt: (v) => typeof v === "string",
    isOnlineBookingEnabled: (v) => typeof v === "boolean",
  });
  if (!row) return null;
  return row as unknown as SafeMasterExtraWorkSnapshot;
}

export function sanitizeMasterExtraWorkDeleteSnapshot(
  raw: unknown,
): SafeMasterExtraWorkDeleteSnapshot | null {
  const row = sanitizeObject(raw, {
    extraWorkWindowId: (v) => typeof v === "string",
    masterId: (v) => typeof v === "string",
    deleted: (v) => v === true,
  });
  if (!row) return null;
  return row as unknown as SafeMasterExtraWorkDeleteSnapshot;
}

export function sanitizeMasterBookingSnapshot(
  raw: unknown,
): SafeMasterBookingSnapshot | null {
  const row = sanitizeObject(raw, {
    bookingId: (v) => typeof v === "string",
    slotId: (v) => typeof v === "string",
    masterId: (v) => typeof v === "string",
    status: (v) => v === "SCHEDULED",
    startsAt: (v) => typeof v === "string",
  });
  if (!row) return null;
  return row as unknown as SafeMasterBookingSnapshot;
}

export type MasterClaimResult<T> =
  | {
      kind: "claimed";
      operationId: string;
      leaseOwner: string;
      persistedFingerprint: string;
    }
  | { kind: "replay_success"; snapshot: T }
  | { kind: "replay_failure"; code: string }
  | { kind: "conflict" }
  | { kind: "in_progress" };

function mapClaim<T>(
  result: ClaimInternalBotOperationIdempotencyResult,
  sanitize: (raw: unknown) => T | null,
): MasterClaimResult<T> {
  if (result.kind === "replay_success") {
    const snapshot = sanitize(result.snapshot);
    if (snapshot == null) {
      throw new Error("MASTER_COMMAND_IDEMPOTENCY_SNAPSHOT_INVALID");
    }
    return { kind: "replay_success", snapshot };
  }
  return result;
}

async function claimMasterOp<T>(
  db: IdempotencyDb,
  input: {
    operationKind: string;
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    sanitize: (raw: unknown) => T | null;
    now?: Date;
  },
): Promise<MasterClaimResult<T>> {
  const result = await claimInternalBotOperationIdempotency(db, {
    operationKind: input.operationKind,
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    matchFingerprints: input.matchFingerprints,
    now: input.now,
    sanitizeSnapshot: input.sanitize,
  });
  return mapClaim(result, input.sanitize);
}

export async function claimMasterCloseIntervalIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterBlockSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_CLOSE_INTERVAL,
    sanitize: sanitizeMasterBlockSnapshot,
  });
}

export async function claimMasterCloseDayIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterBlockSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_CLOSE_DAY,
    sanitize: sanitizeMasterBlockSnapshot,
  });
}

export async function claimMasterDeleteBlockIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterDeleteSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_DELETE_BLOCK,
    sanitize: sanitizeMasterDeleteSnapshot,
  });
}

export async function claimMasterExtraWorkCreateIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterExtraWorkSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_EXTRA_WORK_CREATE,
    sanitize: sanitizeMasterExtraWorkSnapshot,
  });
}

export async function claimMasterExtraWorkDeleteIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterExtraWorkDeleteSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_EXTRA_WORK_DELETE,
    sanitize: sanitizeMasterExtraWorkDeleteSnapshot,
  });
}

export async function claimMasterBookingCreateIdempotency(
  db: IdempotencyDb,
  input: {
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
  },
): Promise<MasterClaimResult<SafeMasterBookingSnapshot>> {
  return claimMasterOp(db, {
    ...input,
    operationKind: MASTER_OP_BOOKING_CREATE,
    sanitize: sanitizeMasterBookingSnapshot,
  });
}

export async function markMasterCommandIdempotencyFailure(
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
