/**
 * Shared durable idempotency for internal bot S2S mutations.
 * Domain-separated by operationKind; HMAC fingerprint only — never raw PII.
 */
import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  Prisma,
  type InternalBotBookingOperationState,
  type Prisma as PrismaNs,
} from "@prisma/client";
import {
  resolveBotIdempotencyHmacConfig,
  type BotIdempotencyHmacConfig,
} from "@/lib/bot-api/booking-create-idempotency-hmac";

export {
  BotIdempotencyHmacConfigError,
  BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE,
  resolveBotIdempotencyHmacConfig,
} from "@/lib/bot-api/booking-create-idempotency-hmac";

export const INTERNAL_BOT_OPERATION_IDEMPOTENCY_LEASE_MS = 45_000;
export const INTERNAL_BOT_OPERATION_IDEMPOTENCY_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;

export function hmacHexFingerprint(secret: string, canonicalPayload: string): string {
  return createHmac("sha256", secret)
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

export function computeInternalBotFingerprintCandidates(
  canonicalPayload: string,
  env: NodeJS.ProcessEnv = process.env,
): { current: string; candidates: string[] } {
  const config = resolveBotIdempotencyHmacConfig(env);
  return computeFingerprintCandidatesWithConfig(canonicalPayload, config);
}

function computeFingerprintCandidatesWithConfig(
  canonicalPayload: string,
  config: BotIdempotencyHmacConfig,
): { current: string; candidates: string[] } {
  const current = hmacHexFingerprint(config.currentSecret, canonicalPayload);
  const previous = config.previousSecrets.map((secret) =>
    hmacHexFingerprint(secret, canonicalPayload),
  );
  return { current, candidates: [current, ...previous] };
}

export function internalBotFingerprintsEqual(
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

export function internalBotFingerprintMatchesAny(
  persisted: string | null | undefined,
  candidates: string[],
): boolean {
  if (!persisted?.trim() || candidates.length === 0) {
    return false;
  }
  for (const candidate of candidates) {
    if (internalBotFingerprintsEqual(persisted, candidate)) {
      return true;
    }
  }
  return false;
}

export function createInternalBotLeaseOwner(): string {
  return randomBytes(16).toString("hex");
}

export type ClaimInternalBotOperationIdempotencyResult =
  | {
      kind: "claimed";
      operationId: string;
      leaseOwner: string;
      persistedFingerprint: string;
    }
  | {
      kind: "replay_success";
      snapshot: unknown;
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

export async function claimInternalBotOperationIdempotency(
  db: IdempotencyDb,
  input: {
    operationKind: string;
    idempotencyKey: string;
    fingerprint: string;
    matchFingerprints: string[];
    now?: Date;
    sanitizeSnapshot: (raw: unknown) => unknown | null;
  },
): Promise<ClaimInternalBotOperationIdempotencyResult> {
  const now = input.now ?? new Date();
  const leaseOwner = createInternalBotLeaseOwner();
  const leaseExpiresAt = new Date(
    now.getTime() + INTERNAL_BOT_OPERATION_IDEMPOTENCY_LEASE_MS,
  );
  const expiresAt = new Date(
    now.getTime() + INTERNAL_BOT_OPERATION_IDEMPOTENCY_RETENTION_MS,
  );

  try {
    const created = await db.internalBotBookingOperation.create({
      data: {
        operationKind: input.operationKind,
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
        operationKind: input.operationKind,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (!existing) {
    return { kind: "in_progress" };
  }

  if (
    !internalBotFingerprintMatchesAny(
      existing.requestFingerprint,
      input.matchFingerprints,
    )
  ) {
    return { kind: "conflict" };
  }

  if (existing.state === "SUCCEEDED") {
    const snapshot = input.sanitizeSnapshot(existing.resultSnapshot);
    if (snapshot == null) {
      throw new Error("INTERNAL_BOT_OPERATION_IDEMPOTENCY_SNAPSHOT_INVALID");
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

export async function markInternalBotOperationIdempotencyFailure(
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
          ? new Date(Date.now() + INTERNAL_BOT_OPERATION_IDEMPOTENCY_LEASE_MS)
          : null,
      resultSnapshot: Prisma.DbNull,
    },
  });
}
