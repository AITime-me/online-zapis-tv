/**
 * Atomic phone+campaign attempt helpers for Wheel of Fortune.
 * Production registration lives in WheelGameSessionService (Prisma INSERT first).
 * InMemory registry remains for pure concurrent semantics unit tests.
 */

import { Prisma } from "@prisma/client";
import {
  buildPhoneAttemptUniqueKey,
  GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX,
  isWheelPhoneCampaignUniqueTarget,
  type PhoneAttemptUniqueKey,
} from "@/lib/game/wheel/participant-phone-hash";

export type WheelPhoneAttemptSessionRow = {
  id: string;
  gameCatalogId: string;
  browserVisitorHash: string | null;
  participantPhoneHash: string | null;
  campaignKeySnapshot: string | null;
  attemptIdHash: string | null;
  status: string;
  serverAssignment: unknown;
  tokenHash: string | null;
};

export type RegisterWheelPhoneAttemptInput = {
  gameCatalogId: string;
  campaignKey: string | null;
  normalizedPhone: string;
  browserVisitorHash: string;
  attemptId: string;
};

/**
 * In-memory unique registry for concurrent INSERT semantics in unit tests.
 * Does not replace the Prisma production path.
 */
export class InMemoryPhoneAttemptRegistry {
  private readonly rows = new Map<
    string,
    {
      sessionId: string;
      browserVisitorHash: string;
      attemptIdHash: string;
      assignment: unknown;
      sessionToken: string;
    }
  >();

  private keyOf(unique: PhoneAttemptUniqueKey): string {
    return `${unique.gameCatalogId}|${unique.campaignKeySnapshot}|${unique.participantPhoneHash}`;
  }

  tryInsert(input: {
    uniqueKey: PhoneAttemptUniqueKey;
    sessionId: string;
    browserVisitorHash: string;
    attemptIdHash: string;
    assignment: unknown;
    sessionToken: string;
  }):
    | { ok: true; kind: "created" }
    | {
        ok: true;
        kind: "idempotent_reuse";
        sessionId: string;
        assignment: unknown;
        sessionToken: string;
      }
    | { ok: false; error: "PHONE_ATTEMPT_EXISTS" } {
    const key = this.keyOf(input.uniqueKey);
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, {
        sessionId: input.sessionId,
        browserVisitorHash: input.browserVisitorHash,
        attemptIdHash: input.attemptIdHash,
        assignment: input.assignment,
        sessionToken: input.sessionToken,
      });
      return { ok: true, kind: "created" };
    }

    if (
      existing.browserVisitorHash === input.browserVisitorHash &&
      existing.attemptIdHash === input.attemptIdHash
    ) {
      return {
        ok: true,
        kind: "idempotent_reuse",
        sessionId: existing.sessionId,
        assignment: existing.assignment,
        sessionToken: existing.sessionToken,
      };
    }

    return { ok: false, error: "PHONE_ATTEMPT_EXISTS" };
  }

  size(): number {
    return this.rows.size;
  }
}

export function classifyWheelSessionP2002(
  target: string | string[] | null | undefined,
): "phone_campaign_unique" | "token_hash" | "other" {
  if (isWheelPhoneCampaignUniqueTarget(target)) {
    return "phone_campaign_unique";
  }
  if (
    target === "token_hash" ||
    target === "tokenHash" ||
    (Array.isArray(target) &&
      target.some((part) => part === "token_hash" || part === "tokenHash"))
  ) {
    return "token_hash";
  }
  if (
    typeof target === "string" &&
    target.includes(GAME_SESSION_PHONE_CAMPAIGN_UNIQUE_INDEX)
  ) {
    return "phone_campaign_unique";
  }
  return "other";
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function readPrismaUniqueTarget(
  error: unknown,
): string | string[] | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return null;
  }
  const target = error.meta?.target;
  if (typeof target === "string") {
    return target;
  }
  if (Array.isArray(target)) {
    return target.map(String);
  }
  return null;
}

export function planWheelPhoneAttemptRegistration(
  input: RegisterWheelPhoneAttemptInput & { env?: NodeJS.ProcessEnv },
): {
  uniqueKey: PhoneAttemptUniqueKey;
  insertFields: {
    participantPhoneHash: string;
    campaignKeySnapshot: string;
  };
} {
  const uniqueKey = buildPhoneAttemptUniqueKey({
    normalizedPhone: input.normalizedPhone,
    gameCatalogId: input.gameCatalogId,
    campaignKey: input.campaignKey,
    env: input.env,
  });

  return {
    uniqueKey,
    insertFields: {
      participantPhoneHash: uniqueKey.participantPhoneHash,
      campaignKeySnapshot: uniqueKey.campaignKeySnapshot,
    },
  };
}

/**
 * Pure concurrent semantics helper for unit tests (not the Prisma production path).
 */
export function registerWheelPhoneAttemptConcurrentSafe(input: {
  registry: InMemoryPhoneAttemptRegistry;
  normalizedPhone: string;
  gameCatalogId: string;
  campaignKey: string | null;
  browserVisitorHash: string;
  attemptIdHash: string;
  sessionId: string;
  sessionToken: string;
  assignment: unknown;
  env?: NodeJS.ProcessEnv;
}):
  | {
      ok: true;
      kind: "created";
      uniqueKey: PhoneAttemptUniqueKey;
    }
  | {
      ok: true;
      kind: "idempotent_reuse";
      uniqueKey: PhoneAttemptUniqueKey;
      existingSessionId: string;
      existingAssignment: unknown;
      sessionToken: string;
    }
  | {
      ok: false;
      error: "PHONE_ATTEMPT_EXISTS";
      uniqueKey: PhoneAttemptUniqueKey;
      message: string;
    } {
  const planned = planWheelPhoneAttemptRegistration({
    normalizedPhone: input.normalizedPhone,
    gameCatalogId: input.gameCatalogId,
    campaignKey: input.campaignKey,
    browserVisitorHash: input.browserVisitorHash,
    attemptId: "00000000-0000-4000-8000-000000000001",
    env: input.env,
  });

  const inserted = input.registry.tryInsert({
    uniqueKey: planned.uniqueKey,
    sessionId: input.sessionId,
    browserVisitorHash: input.browserVisitorHash,
    attemptIdHash: input.attemptIdHash,
    assignment: input.assignment,
    sessionToken: input.sessionToken,
  });

  if (inserted.ok && inserted.kind === "created") {
    return {
      ok: true,
      kind: "created",
      uniqueKey: planned.uniqueKey,
    };
  }

  if (inserted.ok && inserted.kind === "idempotent_reuse") {
    return {
      ok: true,
      kind: "idempotent_reuse",
      uniqueKey: planned.uniqueKey,
      existingSessionId: inserted.sessionId,
      existingAssignment: inserted.assignment,
      sessionToken: inserted.sessionToken,
    };
  }

  return {
    ok: false,
    error: "PHONE_ATTEMPT_EXISTS",
    uniqueKey: planned.uniqueKey,
    message: "Этот номер уже участвовал в данной кампании",
  };
}
