/**
 * Prisma-backed atomic phone+campaign wheel session registration.
 * Prefer importing via WheelGameSessionService (server-only) from app code.
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
import { WheelSecretError } from "@/lib/game/wheel/wheel-env-contract";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import { normalizeGameBookingPhoneKey } from "@/lib/game/game-open-request-policy";

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
        | "PHONE_ATTEMPT_EXISTS"
        | "INVALID_INPUT"
        | "SECRET_UNAVAILABLE"
        | "SESSION_TOKEN_CONFLICT"
        | "SESSION_CREATE_CONFLICT"
        | "RESULT_UNAVAILABLE";
      message: string;
    };

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
  if (input.serverAssignment?.mechanicType !== "WHEEL_OF_FORTUNE") {
    return { ok: false, message: "serverAssignment mechanic is invalid" };
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

function parseStoredAssignment(
  raw: unknown,
): WheelServerAssignmentV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Partial<WheelServerAssignmentV1>;
  if (value.mechanicType !== "WHEEL_OF_FORTUNE" || value.version !== 1) {
    return null;
  }
  if (
    typeof value.sectorIndex !== "number" ||
    typeof value.giftId !== "string" ||
    typeof value.prizeSystemKey !== "string"
  ) {
    return null;
  }
  return value as WheelServerAssignmentV1;
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
  const stored = parseStoredAssignment(raw);
  if (!stored) {
    return {
      ok: false,
      error: "RESULT_UNAVAILABLE",
      message: "Результат игры временно недоступен",
    };
  }
  return { ok: true, assignment: stored };
}

/**
 * Atomically register a phone-bound wheel session.
 * INSERT is always attempted first; P2002 drives idempotent reuse / reject.
 * Public activation of WHEEL_OF_FORTUNE remains blocked elsewhere until stage 2.
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
  const assignmentJson = input.serverAssignment as unknown as Prisma.InputJsonValue;

  try {
    const created = await db.gameSession.create({
      data: {
        gameCatalogId: uniqueKey.gameCatalogId,
        tokenHash,
        browserVisitorHash: input.browserVisitorHash.trim(),
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
      ok: true,
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

    const existingByPhone = await db.gameSession.findFirst({
      where: {
        gameCatalogId: uniqueKey.gameCatalogId,
        campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
        participantPhoneHash: uniqueKey.participantPhoneHash,
      },
      select: {
        id: true,
        browserVisitorHash: true,
        attemptIdHash: true,
        participantPhoneHash: true,
        campaignKeySnapshot: true,
        playExpiresAt: true,
        serverAssignment: true,
        tokenHash: true,
      },
    });

    if (existingByPhone) {
      const sameAttempt =
        attemptIdHashesEqual(existingByPhone.attemptIdHash, attemptIdHash) &&
        existingByPhone.browserVisitorHash === input.browserVisitorHash.trim() &&
        participantPhoneHashesEqual(
          existingByPhone.participantPhoneHash,
          uniqueKey.participantPhoneHash,
        );

      if (sameAttempt) {
        const stored = requireStoredAssignment(existingByPhone.serverAssignment);
        if (!stored.ok) {
          return stored;
        }
        return {
          ok: true,
          session: toPublicDto({
            sessionId: existingByPhone.id,
            sessionToken,
            playExpiresAt: existingByPhone.playExpiresAt,
            created: false,
            serverAssignment: stored.assignment,
          }),
        };
      }

      return {
        ok: false,
        error: "PHONE_ATTEMPT_EXISTS",
        message: "Этот номер уже участвовал в данной кампании",
      };
    }

    if (conflictKind === "token_hash") {
      const existingByToken = await db.gameSession.findFirst({
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
        existingByToken.browserVisitorHash === input.browserVisitorHash.trim()
      ) {
        const stored = requireStoredAssignment(existingByToken.serverAssignment);
        if (!stored.ok) {
          return stored;
        }
        return {
          ok: true,
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
        ok: false,
        error: "SESSION_TOKEN_CONFLICT",
        message: "Не удалось создать игровую сессию",
      };
    }

    return {
      ok: false,
      error: "SESSION_CREATE_CONFLICT",
      message: "Не удалось создать игровую сессию",
    };
  }
}
