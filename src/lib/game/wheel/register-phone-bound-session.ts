/**
 * Prisma-backed atomic phone+campaign wheel session registration.
 * Prefer importing via WheelGameSessionService (server-only) from app code.
 *
 * Registration uses a transaction-scoped PostgreSQL advisory lock so that
 * concurrent requests after cooldown cannot create two prizes. Lifetime
 * unique index was replaced by a 14-day replay cooldown.
 */
import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import {
  attemptIdHashesEqual,
  deriveWheelSessionTokenHash,
  hashWheelAttemptId,
  isValidWheelAttemptId,
} from "@/lib/game/wheel/attempt-id";
import {
  buildPhoneAttemptUniqueKey,
  participantPhoneHashesEqual,
} from "@/lib/game/wheel/participant-phone-hash";
import {
  classifyWheelSessionP2002,
  isPrismaUniqueViolation,
  readPrismaUniqueTarget,
} from "@/lib/game/wheel/phone-attempt-registration";
import { parseWheelServerAssignment } from "@/lib/game/wheel/parse-wheel-assignment";
import { WheelSecretError } from "@/lib/game/wheel/wheel-env-contract";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import { normalizeGameBookingPhoneKey } from "@/lib/game/game-open-request-policy";
import {
  buildWheelPhoneParticipantLockKey,
  computeWheelReplayRetryAt,
  formatWheelCooldownMessage,
  isWheelReplayCooldownActive,
} from "@/lib/game/wheel/wheel-replay-cooldown";

export type WheelSessionPublicDto = {
  sessionId: string;
  sessionToken: string;
  status: "ACTIVE";
  expiresAt: string;
  created: boolean;
  mechanicType: "WHEEL_OF_FORTUNE";
  /** Persisted server assignment — client may only animate this result. */
  serverAssignment: WheelServerAssignmentV1;
};

export type RegisterWheelPhoneBoundSessionInput = {
  gameCatalogId: string;
  campaignKey: string | null;
  /**
   * Raw or formatted phone. Always re-normalized server-side before hashing.
   * Prefer this over normalizedPhone.
   */
  phone?: string;
  /**
   * Accepted alias for callers that already named the field.
   * Still re-normalized — never trusted as already canonical.
   */
  normalizedPhone?: string;
  browserVisitorHash: string;
  attemptId: string;
  serverAssignment: WheelServerAssignmentV1;
  playExpiresAt: Date;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests. Defaults to app prisma. */
  db?: PrismaClient;
};

export type RegisterWheelPhoneBoundSessionResult =
  | { ok: true; session: WheelSessionPublicDto }
  | {
      ok: false;
      error:
        | "WHEEL_COOLDOWN_ACTIVE"
        | "INVALID_INPUT"
        | "SECRET_UNAVAILABLE"
        | "SESSION_TOKEN_CONFLICT"
        | "SESSION_CREATE_CONFLICT"
        | "RESULT_UNAVAILABLE";
      message: string;
      retryAt?: string;
    };

type TxClient = Prisma.TransactionClient;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function resolveRawPhoneInput(
  input: RegisterWheelPhoneBoundSessionInput,
): string {
  if (typeof input.phone === "string" && input.phone.trim()) {
    return input.phone;
  }
  if (
    typeof input.normalizedPhone === "string" &&
    input.normalizedPhone.trim()
  ) {
    return input.normalizedPhone;
  }
  return "";
}

function validateRegisterInput(
  input: RegisterWheelPhoneBoundSessionInput,
): { ok: true; canonicalPhone: string } | { ok: false; message: string } {
  if (!isUuid(input.gameCatalogId.trim())) {
    return { ok: false, message: "gameCatalogId is invalid" };
  }

  const rawPhone = resolveRawPhoneInput(input);
  if (!rawPhone.trim()) {
    return { ok: false, message: "phone is required" };
  }
  const canonicalPhone = normalizeGameBookingPhoneKey(rawPhone);
  if (!canonicalPhone) {
    return { ok: false, message: "phone is invalid" };
  }

  if (!/^[a-f0-9]{64}$/i.test(input.browserVisitorHash.trim())) {
    return { ok: false, message: "browserVisitorHash is invalid" };
  }
  if (!isValidWheelAttemptId(input.attemptId)) {
    return { ok: false, message: "attemptId is invalid" };
  }
  if (!parseWheelServerAssignment(input.serverAssignment)) {
    return { ok: false, message: "serverAssignment is invalid" };
  }
  if (
    !(input.playExpiresAt instanceof Date) ||
    Number.isNaN(input.playExpiresAt.getTime())
  ) {
    return { ok: false, message: "playExpiresAt is invalid" };
  }
  return { ok: true, canonicalPhone };
}

function toPublicDto(input: {
  sessionId: string;
  sessionToken: string;
  playExpiresAt: Date;
  created: boolean;
  serverAssignment: WheelServerAssignmentV1;
}): WheelSessionPublicDto {
  return {
    sessionId: input.sessionId,
    sessionToken: input.sessionToken,
    status: "ACTIVE",
    expiresAt: input.playExpiresAt.toISOString(),
    created: input.created,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverAssignment: input.serverAssignment,
  };
}

function requireStoredAssignment(
  raw: unknown,
):
  | { ok: true; assignment: WheelServerAssignmentV1 }
  | {
      ok: false;
      error: "RESULT_UNAVAILABLE";
      message: string;
    } {
  const stored = parseWheelServerAssignment(raw);
  if (!stored) {
    return {
      ok: false,
      error: "RESULT_UNAVAILABLE",
      message: "Результат игры временно недоступен",
    };
  }
  return { ok: true, assignment: stored };
}

function cooldownFailure(startedAt: Date): RegisterWheelPhoneBoundSessionResult {
  const retryAt = computeWheelReplayRetryAt(startedAt);
  return {
    ok: false,
    error: "WHEEL_COOLDOWN_ACTIVE",
    message: formatWheelCooldownMessage(retryAt),
    retryAt: retryAt.toISOString(),
  };
}

async function acquireParticipantLock(
  tx: TxClient,
  lockKey: bigint,
): Promise<void> {
  // Bind as text → bigint so signed lock keys stay portable across Prisma adapters.
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock($1::bigint)`,
    lockKey.toString(),
  );
}

/**
 * Atomically register a phone-bound wheel session under advisory lock.
 * Idempotent same attemptId+visitor reuse; new attempts respect 14-day cooldown.
 */
export async function registerWheelPhoneBoundSession(
  input: RegisterWheelPhoneBoundSessionInput,
): Promise<RegisterWheelPhoneBoundSessionResult> {
  const validated = validateRegisterInput(input);
  if (!validated.ok) {
    return { ok: false, error: "INVALID_INPUT", message: validated.message };
  }

  const env = input.env ?? process.env;
  const db = input.db ?? defaultPrisma;

  let uniqueKey;
  let attemptIdHash: string;
  let sessionToken: string;
  let tokenHash: string;
  try {
    uniqueKey = buildPhoneAttemptUniqueKey({
      normalizedPhone: validated.canonicalPhone,
      gameCatalogId: input.gameCatalogId,
      campaignKey: input.campaignKey,
      env,
    });
    attemptIdHash = hashWheelAttemptId(input.attemptId, env);
    const derived = deriveWheelSessionTokenHash({
      attemptId: input.attemptId,
      gameCatalogId: uniqueKey.gameCatalogId,
      campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
      participantPhoneHash: uniqueKey.participantPhoneHash,
      env,
    });
    sessionToken = derived.sessionToken;
    tokenHash = derived.tokenHash;
  } catch (error) {
    if (error instanceof WheelSecretError) {
      return {
        ok: false,
        error: "SECRET_UNAVAILABLE",
        message: "Server configuration is incomplete",
      };
    }
    throw error;
  }

  const now = input.now ?? new Date();
  const assignmentJson =
    input.serverAssignment as unknown as Prisma.InputJsonValue;
  const visitorHash = input.browserVisitorHash.trim();
  const lockKey = buildWheelPhoneParticipantLockKey(uniqueKey);

  try {
    return await db.$transaction(async (tx) => {
      await acquireParticipantLock(tx, lockKey);

      const sameAttempt = await tx.gameSession.findFirst({
        where: {
          gameCatalogId: uniqueKey.gameCatalogId,
          campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
          participantPhoneHash: uniqueKey.participantPhoneHash,
          attemptIdHash,
          browserVisitorHash: visitorHash,
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          browserVisitorHash: true,
          attemptIdHash: true,
          participantPhoneHash: true,
          playExpiresAt: true,
          serverAssignment: true,
          startedAt: true,
        },
      });

      if (sameAttempt) {
        const same =
          attemptIdHashesEqual(sameAttempt.attemptIdHash, attemptIdHash) &&
          sameAttempt.browserVisitorHash === visitorHash &&
          participantPhoneHashesEqual(
            sameAttempt.participantPhoneHash,
            uniqueKey.participantPhoneHash,
          );
        if (same) {
          const stored = requireStoredAssignment(sameAttempt.serverAssignment);
          if (!stored.ok) {
            return stored;
          }
          return {
            ok: true as const,
            session: toPublicDto({
              sessionId: sameAttempt.id,
              sessionToken,
              playExpiresAt: sameAttempt.playExpiresAt,
              created: false,
              serverAssignment: stored.assignment,
            }),
          };
        }
      }

      const latest = await tx.gameSession.findFirst({
        where: {
          gameCatalogId: uniqueKey.gameCatalogId,
          campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
          participantPhoneHash: uniqueKey.participantPhoneHash,
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          startedAt: true,
        },
      });

      if (latest && isWheelReplayCooldownActive(latest.startedAt, now)) {
        return cooldownFailure(latest.startedAt);
      }

      try {
        const created = await tx.gameSession.create({
          data: {
            gameCatalogId: uniqueKey.gameCatalogId,
            tokenHash,
            browserVisitorHash: visitorHash,
            participantPhoneHash: uniqueKey.participantPhoneHash,
            campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
            attemptIdHash,
            status: "ACTIVE",
            startedAt: now,
            playExpiresAt: input.playExpiresAt,
            serverAssignment: assignmentJson,
          },
          select: {
            id: true,
            playExpiresAt: true,
            serverAssignment: true,
          },
        });

        const stored = requireStoredAssignment(created.serverAssignment);
        if (!stored.ok) {
          return stored;
        }

        return {
          ok: true as const,
          session: toPublicDto({
            sessionId: created.id,
            sessionToken,
            playExpiresAt: created.playExpiresAt,
            created: true,
            serverAssignment: stored.assignment,
          }),
        };
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) {
          throw error;
        }

        const conflictKind = classifyWheelSessionP2002(
          readPrismaUniqueTarget(error),
        );

        if (conflictKind === "token_hash") {
          const existingByToken = await tx.gameSession.findFirst({
            where: { tokenHash },
            select: {
              id: true,
              browserVisitorHash: true,
              attemptIdHash: true,
              playExpiresAt: true,
              serverAssignment: true,
            },
          });

          if (
            existingByToken &&
            attemptIdHashesEqual(existingByToken.attemptIdHash, attemptIdHash) &&
            existingByToken.browserVisitorHash === visitorHash
          ) {
            const stored = requireStoredAssignment(
              existingByToken.serverAssignment,
            );
            if (!stored.ok) {
              return stored;
            }
            return {
              ok: true as const,
              session: toPublicDto({
                sessionId: existingByToken.id,
                sessionToken,
                playExpiresAt: existingByToken.playExpiresAt,
                created: false,
                serverAssignment: stored.assignment,
              }),
            };
          }

          return {
            ok: false as const,
            error: "SESSION_TOKEN_CONFLICT" as const,
            message: "Не удалось создать игровую сессию",
          };
        }

        // Legacy unique index may still exist briefly during rolling deploy.
        if (conflictKind === "phone_campaign_unique") {
          const existingByPhone = await tx.gameSession.findFirst({
            where: {
              gameCatalogId: uniqueKey.gameCatalogId,
              campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
              participantPhoneHash: uniqueKey.participantPhoneHash,
            },
            orderBy: { startedAt: "desc" },
            select: {
              id: true,
              browserVisitorHash: true,
              attemptIdHash: true,
              participantPhoneHash: true,
              playExpiresAt: true,
              serverAssignment: true,
              startedAt: true,
            },
          });

          if (existingByPhone) {
            const same =
              attemptIdHashesEqual(
                existingByPhone.attemptIdHash,
                attemptIdHash,
              ) &&
              existingByPhone.browserVisitorHash === visitorHash &&
              participantPhoneHashesEqual(
                existingByPhone.participantPhoneHash,
                uniqueKey.participantPhoneHash,
              );
            if (same) {
              const stored = requireStoredAssignment(
                existingByPhone.serverAssignment,
              );
              if (!stored.ok) {
                return stored;
              }
              return {
                ok: true as const,
                session: toPublicDto({
                  sessionId: existingByPhone.id,
                  sessionToken,
                  playExpiresAt: existingByPhone.playExpiresAt,
                  created: false,
                  serverAssignment: stored.assignment,
                }),
              };
            }
            return cooldownFailure(existingByPhone.startedAt);
          }
        }

        return {
          ok: false as const,
          error: "SESSION_CREATE_CONFLICT" as const,
          message: "Не удалось создать игровую сессию",
        };
      }
    });
  } catch (error) {
    throw error;
  }
}
