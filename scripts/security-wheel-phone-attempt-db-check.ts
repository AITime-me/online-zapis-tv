process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { createWheelAttemptId } from "../src/lib/game/wheel/client-attempt-id";
import {
  deriveWheelSessionToken,
  hashWheelAttemptId,
} from "../src/lib/game/wheel/attempt-id";
import { hashOpaqueToken } from "../src/lib/game/session/game-session-token";
import {
  buildPhoneAttemptUniqueKey,
  hashParticipantPhone,
} from "../src/lib/game/wheel/participant-phone-hash";
import {
  assertNoHardcodedProductionWheelFallback,
  resolveWheelHmacSecret,
  WheelSecretError,
} from "../src/lib/game/wheel/wheel-env-contract";
import { registerWheelPhoneBoundSession } from "../src/lib/game/wheel/register-phone-bound-session";
import type { WheelServerAssignmentV1 } from "../src/lib/game/wheel/wheel-assignment-contract";
import {
  buildTestWheelServerAssignment,
  buildWheelAssignmentPrizeSnapshot,
} from "../src/lib/game/wheel/wheel-assignment-prize-snapshot";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  serializeDefaultPrizeRules,
} from "../src/lib/game/wheel/default-prizes";
import { normalizeGameBookingPhoneKey } from "../src/lib/game/game-open-request-policy";
import { normalizePhone } from "../src/lib/phone/normalize-phone";
import {
  WHEEL_REPLAY_COOLDOWN_MS,
  buildWheelPhoneParticipantLockKey,
  computeWheelReplayRetryAt,
} from "../src/lib/game/wheel/wheel-replay-cooldown";

const ROOT = process.cwd();
const TEST_ENV = {
  NODE_ENV: "test",
  AUTH_SECRET: "test-auth-secret-16chars-min",
  SECURITY_BATCH_TEST: "1",
} as NodeJS.ProcessEnv;

const CATALOG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VISITOR_A = createHash("sha256").update("visitor-a").digest("hex");
const VISITOR_B = createHash("sha256").update("visitor-b").digest("hex");

const PHONE_FORMATS = [
  "79991234567",
  "+7 999 123-45-67",
  "8 (999) 123-45-67",
] as const;

function buildTestGifts() {
  return DEFAULT_WHEEL_PRIZE_DEFINITIONS.map((definition, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: definition.name,
    shortDescription: definition.shortDescription,
    image: null,
    priority:
      definition.systemKey === "permanent_discount_20" ? "jackpot" : "standard",
    cardStyle: "default",
    isActive: definition.isActive,
    probability: definition.sectorCount,
    systemKey: definition.systemKey,
    sortOrder: definition.sortOrder,
    prizeType: definition.prizeType,
    prizeRules: serializeDefaultPrizeRules(definition),
    activationMode: "SINGLE_PAID_SERVICE" as const,
    minCourseSessions: null,
    activationConditionText: definition.activationConditionText,
  }));
}

function assignment(sectorIndex: number): WheelServerAssignmentV1 {
  const gifts = buildTestGifts();
  const gift = gifts[sectorIndex] ?? gifts[0]!;
  const prizeSnapshot = buildWheelAssignmentPrizeSnapshot(gift.id, gifts);
  if (!prizeSnapshot) {
    throw new Error("test prize snapshot unavailable");
  }
  return buildTestWheelServerAssignment({
    sectorIndex,
    giftId: gift.id,
    prizeSystemKey: gift.systemKey!,
    prizeSnapshot,
  });
}

function assertServiceSourceContracts(): void {
  const servicePath = path.join(ROOT, "src/services/WheelGameSessionService.ts");
  const serviceSource = fs.readFileSync(servicePath, "utf8");
  assert.match(serviceSource, /import "server-only"/);
  assert.match(
    serviceSource,
    /register-phone-bound-session|registerWheelPhoneBoundSession/,
  );

  const implPath = path.join(
    ROOT,
    "src/lib/game/wheel/register-phone-bound-session.ts",
  );
  const source = fs.readFileSync(implPath, "utf8");
  assert.match(source, /import "server-only"/);
  assert.match(source, /normalizeGameBookingPhoneKey|normalizePhone/);
  assert.match(source, /\$transaction|pg_advisory_xact_lock/);
  assert.match(source, /\$executeRawUnsafe|pg_advisory_xact_lock/);
  assert.match(source, /gameSession\.create/);
  assert.match(source, /WHEEL_COOLDOWN_ACTIVE|isWheelReplayCooldownActive/);
  assert.match(source, /attemptIdHash/);
  assert.match(source, /participantPhoneHash/);
  assert.match(source, /RESULT_UNAVAILABLE/);
  assert.doesNotMatch(
    source,
    /parseStoredAssignment\([^)]+\)\s*\?\?\s*input\.serverAssignment/,
  );
  assert.doesNotMatch(source, /production-wheel-phone-attempt-hmac-fallback/);
  assertNoHardcodedProductionWheelFallback(source);
  assert.doesNotMatch(source, /gameSession\.update/);

  assert.ok(
    source.includes("pg_advisory_xact_lock") ||
      source.includes("buildWheelPhoneParticipantLockKey"),
    "must take advisory lock before create",
  );

  const cooldown = fs.readFileSync(
    path.join(ROOT, "src/lib/game/wheel/wheel-replay-cooldown.ts"),
    "utf8",
  );
  assert.match(cooldown, /WHEEL_REPLAY_COOLDOWN_MS\s*=\s*14\s*\*\s*24/);
  assert.match(
    cooldown,
    /game_sessions_catalog_campaign_phone_started_idx/,
  );

  const migrationCooldown = fs.readFileSync(
    path.join(
      ROOT,
      "prisma/migrations/20260804180000_wheel_phone_replay_cooldown/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    migrationCooldown,
    /DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_hash_uidx"/,
  );
  assert.match(
    migrationCooldown,
    /CREATE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_started_idx"/,
  );
  assert.doesNotMatch(migrationCooldown, /DELETE FROM|TRUNCATE|UPDATE "game_sessions"/);

  for (const relative of [
    "src/lib/game/wheel/participant-phone-hash.ts",
    "src/lib/game/wheel/wheel-env-contract.ts",
    "src/lib/game/wheel/attempt-id.ts",
    "src/lib/game/wheel/register-phone-bound-session.ts",
  ]) {
    const moduleSource = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.match(moduleSource, /import "server-only"/, relative);
    assert.doesNotMatch(moduleSource, /process\.env\.NEXT_PUBLIC_/);
  }

  const clientAttemptPath = path.join(
    ROOT,
    "src/lib/game/wheel/client-attempt-id.ts",
  );
  const clientSource = fs.readFileSync(clientAttemptPath, "utf8");
  assert.doesNotMatch(clientSource, /from\s+["']node:crypto["']/);
  assert.doesNotMatch(clientSource, /require\(\s*["']node:crypto["']\s*\)/);
  assert.doesNotMatch(clientSource, /createHmac/);
  assert.doesNotMatch(clientSource, /wheel-env-contract/);
  assert.doesNotMatch(clientSource, /["']server-only["']/);
  assert.doesNotMatch(
    clientSource,
    /AUTH_SECRET|NEXTAUTH_SECRET|WHEEL_OF_FORTUNE_CAMPAIGN_SECRET/,
  );
  assert.match(clientSource, /globalThis\.crypto\.randomUUID|cryptoApi\.randomUUID/);
  assert.match(clientSource, /createWheelAttemptId/);
  assert.match(clientSource, /isValidWheelAttemptId/);

  const serverAttemptSource = fs.readFileSync(
    path.join(ROOT, "src/lib/game/wheel/attempt-id.ts"),
    "utf8",
  );
  assert.match(serverAttemptSource, /createHmac/);
  assert.match(serverAttemptSource, /deriveWheelSessionToken/);
  assert.doesNotMatch(serverAttemptSource, /export function createWheelAttemptId/);

  const envSource = fs.readFileSync(
    path.join(ROOT, "src/lib/game/wheel/participant-phone-hash.ts"),
    "utf8",
  );
  assertNoHardcodedProductionWheelFallback(envSource);

  const migration = fs.readFileSync(
    path.join(
      ROOT,
      "prisma/migrations/20260803160000_wheel_attempt_idempotency_hash/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /attempt_id_hash/);
  assert.match(migration, /Rollback-safe/);
}

type FakeRow = {
  id: string;
  gameCatalogId: string;
  tokenHash: string;
  browserVisitorHash: string;
  participantPhoneHash: string;
  campaignKeySnapshot: string;
  attemptIdHash: string;
  playExpiresAt: Date;
  startedAt: Date;
  serverAssignment: unknown;
  createOrder: number;
};

function createFakePrisma() {
  const rows: FakeRow[] = [];
  let createOrder = 0;
  let createCalls = 0;
  let updateCalls = 0;
  let lockCalls = 0;

  function matchesWhere(
    row: FakeRow,
    where: Record<string, unknown>,
  ): boolean {
    if (where.tokenHash) {
      return row.tokenHash === where.tokenHash;
    }
    if (where.gameCatalogId && row.gameCatalogId !== where.gameCatalogId) {
      return false;
    }
    if (
      where.campaignKeySnapshot &&
      row.campaignKeySnapshot !== where.campaignKeySnapshot
    ) {
      return false;
    }
    if (
      where.participantPhoneHash &&
      row.participantPhoneHash !== where.participantPhoneHash
    ) {
      return false;
    }
    if (where.attemptIdHash && row.attemptIdHash !== where.attemptIdHash) {
      return false;
    }
    if (
      where.browserVisitorHash &&
      row.browserVisitorHash !== where.browserVisitorHash
    ) {
      return false;
    }
    return Boolean(
      where.gameCatalogId ||
        where.campaignKeySnapshot ||
        where.participantPhoneHash ||
        where.attemptIdHash ||
        where.browserVisitorHash,
    );
  }

  const gameSession = {
    async create(args: {
      data: {
        gameCatalogId: string;
        tokenHash: string;
        browserVisitorHash: string;
        participantPhoneHash: string;
        campaignKeySnapshot: string;
        attemptIdHash: string;
        playExpiresAt: Date;
        startedAt?: Date;
        serverAssignment: unknown;
      };
      select: Record<string, boolean>;
    }) {
      createCalls += 1;
      createOrder += 1;
      const data = args.data;

      const tokenConflict = rows.find((row) => row.tokenHash === data.tokenHash);
      if (tokenConflict) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["token_hash"] },
        });
      }

      const row: FakeRow = {
        id: randomUUID(),
        gameCatalogId: data.gameCatalogId,
        tokenHash: data.tokenHash,
        browserVisitorHash: data.browserVisitorHash,
        participantPhoneHash: data.participantPhoneHash,
        campaignKeySnapshot: data.campaignKeySnapshot,
        attemptIdHash: data.attemptIdHash,
        playExpiresAt: data.playExpiresAt,
        startedAt: data.startedAt ?? new Date(),
        serverAssignment: data.serverAssignment,
        createOrder,
      };
      rows.push(row);
      return {
        id: row.id,
        playExpiresAt: row.playExpiresAt,
        serverAssignment: row.serverAssignment,
      };
    },

    async findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy?: { startedAt?: "asc" | "desc" };
    }) {
      const matches = rows.filter((row) => matchesWhere(row, args.where));
      if (args.orderBy?.startedAt === "desc") {
        matches.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      } else if (args.orderBy?.startedAt === "asc") {
        matches.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      }
      const found = matches[0];
      return found
        ? {
            id: found.id,
            browserVisitorHash: found.browserVisitorHash,
            attemptIdHash: found.attemptIdHash,
            participantPhoneHash: found.participantPhoneHash,
            campaignKeySnapshot: found.campaignKeySnapshot,
            playExpiresAt: found.playExpiresAt,
            serverAssignment: found.serverAssignment,
            tokenHash: found.tokenHash,
            startedAt: found.startedAt,
          }
        : null;
    },

    async update() {
      updateCalls += 1;
      throw new Error("gameSession.update must not be called");
    },
  };

  const tx = {
    gameSession,
    $executeRaw: async () => {
      lockCalls += 1;
      return 1;
    },
    $executeRawUnsafe: async () => {
      lockCalls += 1;
      return 1;
    },
  };

  return {
    db: {
      gameSession,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      $executeRaw: tx.$executeRaw,
    } as unknown as PrismaClient,
    rows,
    getCreateCalls: () => createCalls,
    getUpdateCalls: () => updateCalls,
    getLockCalls: () => lockCalls,
  };
}

function assertPhoneNormalization(): void {
  const canonical = PHONE_FORMATS.map((phone) => normalizePhone(phone));
  assert.equal(canonical[0], "79991234567");
  assert.equal(canonical[1], "79991234567");
  assert.equal(canonical[2], "79991234567");

  const keys = PHONE_FORMATS.map((phone) => normalizeGameBookingPhoneKey(phone));
  assert.equal(keys[0], "79991234567");
  assert.equal(keys[1], keys[0]);
  assert.equal(keys[2], keys[0]);

  const hashes = PHONE_FORMATS.map((phone) =>
    hashParticipantPhone({
      normalizedPhone: normalizeGameBookingPhoneKey(phone)!,
      gameCatalogId: CATALOG_A,
      campaignKeySnapshot: "permanent-wheel",
      env: TEST_ENV,
    }),
  );
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[0], hashes[2]);

  assert.equal(normalizeGameBookingPhoneKey(""), null);
  assert.equal(normalizeGameBookingPhoneKey("123"), null);
  assert.equal(normalizeGameBookingPhoneKey("not-a-phone"), null);
}

async function assertFakePrismaRegistration(): Promise<void> {
  const playExpiresAt = new Date("2026-08-03T11:00:00.000Z");
  const attemptId = createWheelAttemptId();
  const fake = createFakePrisma();

  const first = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[0],
    browserVisitorHash: VISITOR_A,
    attemptId,
    serverAssignment: assignment(3),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    throw new Error(first.message);
  }
  assert.equal(first.session.created, true);
  assert.equal(first.session.serverAssignment.sectorIndex, 3);
  assert.equal(fake.getCreateCalls(), 1);
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0]!.attemptIdHash, hashWheelAttemptId(attemptId, TEST_ENV));
  assert.notEqual(fake.rows[0]!.attemptIdHash, attemptId);
  assert.notEqual(fake.rows[0]!.tokenHash, first.session.sessionToken);
  assert.equal(fake.rows[0]!.tokenHash, hashOpaqueToken(first.session.sessionToken));
  assert.doesNotMatch(JSON.stringify(fake.rows[0]), /79991234567/);
  assert.doesNotMatch(JSON.stringify(fake.rows[0]), /"attemptId"\s*:/);
  assert.match(JSON.stringify(fake.rows[0]), /"attemptIdHash"/);

  const publicJson = JSON.stringify(first.session);
  assert.doesNotMatch(publicJson, /participantPhoneHash|attemptIdHash|tokenHash/);
  assert.doesNotMatch(publicJson, /79991234567/);

  // Parallel same attempt with alternate phone formatting → winner assignment
  const second = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[1],
    browserVisitorHash: VISITOR_A,
    attemptId,
    serverAssignment: assignment(11),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(second.ok, true);
  if (!second.ok) {
    throw new Error(second.message);
  }
  assert.equal(second.session.created, false);
  assert.equal(second.session.sessionId, first.session.sessionId);
  assert.equal(second.session.sessionToken, first.session.sessionToken);
  assert.equal(second.session.serverAssignment.sectorIndex, 3);
  assert.equal(
    (fake.rows[0]!.serverAssignment as WheelServerAssignmentV1).sectorIndex,
    3,
  );
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.getCreateCalls(), 1);
  assert.equal(fake.getUpdateCalls(), 0);

  // Third format still same phone unique key
  const thirdFormat = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[2],
    browserVisitorHash: VISITOR_B,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(1),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(thirdFormat.ok, false);
  if (thirdFormat.ok) {
    throw new Error("expected WHEEL_COOLDOWN_ACTIVE");
  }
  assert.equal(thirdFormat.error, "WHEEL_COOLDOWN_ACTIVE");
  assert.ok(thirdFormat.retryAt);
  assert.equal(fake.rows.length, 1);
  assert.ok(fake.getLockCalls() >= 1);

  // Invalid / empty / short phone rejected before INSERT
  for (const badPhone of ["", "123", "abc", "999"]) {
    const beforeCreates = fake.getCreateCalls();
    const rejected = await registerWheelPhoneBoundSession({
      gameCatalogId: CATALOG_A,
      campaignKey: "permanent-wheel",
      phone: badPhone,
      browserVisitorHash: VISITOR_A,
      attemptId: createWheelAttemptId(),
      serverAssignment: assignment(2),
      playExpiresAt,
      env: TEST_ENV,
      db: fake.db,
    });
    assert.equal(rejected.ok, false);
    if (rejected.ok) {
      throw new Error("expected INVALID_INPUT");
    }
    assert.equal(rejected.error, "INVALID_INPUT");
    assert.equal(fake.getCreateCalls(), beforeCreates);
  }

  // Corrupted stored assignment must not fall back to loser sector
  fake.rows[0]!.serverAssignment = null;
  const nullAssignmentRetry = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[0],
    browserVisitorHash: VISITOR_A,
    attemptId,
    serverAssignment: assignment(11),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(nullAssignmentRetry.ok, false);
  if (nullAssignmentRetry.ok) {
    throw new Error("expected RESULT_UNAVAILABLE");
  }
  assert.equal(nullAssignmentRetry.error, "RESULT_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(nullAssignmentRetry), /"sectorIndex":\s*11/);
  assert.equal(fake.getUpdateCalls(), 0);
  assert.equal(fake.rows.length, 1);

  fake.rows[0]!.serverAssignment = { version: 1, mechanicType: "CATCH_TIME" };
  const badAssignmentRetry = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[0],
    browserVisitorHash: VISITOR_A,
    attemptId,
    serverAssignment: assignment(11),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(badAssignmentRetry.ok, false);
  if (badAssignmentRetry.ok) {
    throw new Error("expected RESULT_UNAVAILABLE");
  }
  assert.equal(badAssignmentRetry.error, "RESULT_UNAVAILABLE");
  assert.equal(fake.getUpdateCalls(), 0);
  assert.equal(fake.rows.length, 1);

  // Restore winner assignment for remaining cases
  fake.rows[0]!.serverAssignment = assignment(3);

  // Other campaign allowed
  const otherCampaign = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel-v2",
    phone: PHONE_FORMATS[1],
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(2),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(otherCampaign.ok, true);
  assert.equal(fake.rows.length, 2);

  // Other catalog allowed
  const otherCatalog = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_B,
    campaignKey: "procedure-gift",
    phone: PHONE_FORMATS[2],
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(4),
    playExpiresAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(otherCatalog.ok, true);
  assert.equal(fake.rows.length, 3);

  // Browser change does not bypass cooldown for same phone
  const otherBrowser = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: PHONE_FORMATS[0],
    browserVisitorHash: VISITOR_B,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(5),
    playExpiresAt,
    now: new Date("2026-08-03T10:00:00.000Z"),
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(otherBrowser.ok, false);
  if (otherBrowser.ok) {
    throw new Error("expected WHEEL_COOLDOWN_ACTIVE");
  }
  assert.equal(otherBrowser.error, "WHEEL_COOLDOWN_ACTIVE");
  assert.equal(fake.rows.length, 3);

  // Another phone is allowed
  const otherPhone = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: "79990001122",
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(6),
    playExpiresAt,
    now: new Date("2026-08-03T10:00:00.000Z"),
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(otherPhone.ok, true);
  assert.equal(fake.rows.length, 4);

  // Cooldown boundary on a dedicated phone (no intervening plays)
  const boundaryPhone = "79995556677";
  const boundaryStart = new Date("2026-08-04T12:00:00.000Z");
  const boundaryFirst = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: boundaryPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(7),
    playExpiresAt: new Date(boundaryStart.getTime() + 60_000),
    now: boundaryStart,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(boundaryFirst.ok, true);
  assert.equal(fake.rows.length, 5);

  const justBefore = new Date(
    boundaryStart.getTime() + WHEEL_REPLAY_COOLDOWN_MS - 1,
  );
  const exactlyAt = new Date(
    boundaryStart.getTime() + WHEEL_REPLAY_COOLDOWN_MS,
  );
  const after = new Date(
    boundaryStart.getTime() + WHEEL_REPLAY_COOLDOWN_MS + 1,
  );

  const beforeRetry = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: boundaryPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(8),
    playExpiresAt: new Date(justBefore.getTime() + 60_000),
    now: justBefore,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(beforeRetry.ok, false);
  if (beforeRetry.ok) {
    throw new Error("expected cooldown before 14d");
  }
  assert.equal(beforeRetry.error, "WHEEL_COOLDOWN_ACTIVE");
  assert.equal(
    beforeRetry.retryAt,
    computeWheelReplayRetryAt(boundaryStart).toISOString(),
  );
  assert.match(beforeRetry.message, /уже участвовали/i);

  // Exactly at startedAt + 14d allowed
  const exactRetry = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: boundaryPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(9),
    playExpiresAt: new Date(exactlyAt.getTime() + 60_000),
    now: exactlyAt,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(exactRetry.ok, true);
  if (!exactRetry.ok) {
    throw new Error(exactRetry.message);
  }
  assert.equal(exactRetry.session.created, true);
  assert.equal(fake.rows.length, 6);

  // Later than 14d from a fresh single-session phone is allowed
  const laterPhone = "79998887766";
  const laterStart = new Date("2026-07-01T09:00:00.000Z");
  const laterFirst = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: laterPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(10),
    playExpiresAt: new Date(laterStart.getTime() + 60_000),
    now: laterStart,
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(laterFirst.ok, true);
  const laterRetry = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: laterPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(11),
    playExpiresAt: new Date(after.getTime() + 60_000),
    now: new Date(laterStart.getTime() + WHEEL_REPLAY_COOLDOWN_MS + 1),
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(laterRetry.ok, true);
  if (!laterRetry.ok) {
    throw new Error(laterRetry.message);
  }
  assert.equal(laterRetry.session.created, true);

  // Latest startedAt wins when multiple historical rows exist
  const multiPhone = "79990000001";
  const oldPlay = new Date("2026-01-01T00:00:00.000Z");
  const midPlay = new Date("2026-02-01T00:00:00.000Z");
  const newestPlay = new Date("2026-03-01T00:00:00.000Z");
  for (const when of [oldPlay, midPlay, newestPlay]) {
    const seeded = await registerWheelPhoneBoundSession({
      gameCatalogId: CATALOG_A,
      campaignKey: "permanent-wheel",
      phone: multiPhone,
      browserVisitorHash: VISITOR_A,
      attemptId: createWheelAttemptId(),
      serverAssignment: assignment(0),
      playExpiresAt: new Date(when.getTime() + 60_000),
      now: when,
      env: TEST_ENV,
      db: fake.db,
    });
    assert.equal(seeded.ok, true);
  }
  const blockedByLatest = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: multiPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(1),
    playExpiresAt: new Date(newestPlay.getTime() + 60_000),
    now: new Date(newestPlay.getTime() + WHEEL_REPLAY_COOLDOWN_MS - 1),
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(blockedByLatest.ok, false);
  if (!blockedByLatest.ok) {
    assert.equal(blockedByLatest.error, "WHEEL_COOLDOWN_ACTIVE");
    assert.equal(
      blockedByLatest.retryAt,
      computeWheelReplayRetryAt(newestPlay).toISOString(),
    );
  }
  const allowedByLatest = await registerWheelPhoneBoundSession({
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    phone: multiPhone,
    browserVisitorHash: VISITOR_A,
    attemptId: createWheelAttemptId(),
    serverAssignment: assignment(2),
    playExpiresAt: new Date(newestPlay.getTime() + WHEEL_REPLAY_COOLDOWN_MS + 60_000),
    now: new Date(newestPlay.getTime() + WHEEL_REPLAY_COOLDOWN_MS),
    env: TEST_ENV,
    db: fake.db,
  });
  assert.equal(allowedByLatest.ok, true);

  assert.doesNotMatch(JSON.stringify(fake.rows), /79991234567|79995556677|79998887766|79990000001/);

  // Deterministic tokens
  const key = buildPhoneAttemptUniqueKey({
    normalizedPhone: "79991234567",
    gameCatalogId: CATALOG_A,
    campaignKey: "permanent-wheel",
    env: TEST_ENV,
  });
  const tokenAgain = deriveWheelSessionToken({
    attemptId,
    gameCatalogId: key.gameCatalogId,
    campaignKeySnapshot: key.campaignKeySnapshot,
    participantPhoneHash: key.participantPhoneHash,
    env: TEST_ENV,
  });
  assert.equal(tokenAgain, first.session.sessionToken);
  assert.notEqual(
    deriveWheelSessionToken({
      attemptId: createWheelAttemptId(),
      gameCatalogId: key.gameCatalogId,
      campaignKeySnapshot: key.campaignKeySnapshot,
      participantPhoneHash: key.participantPhoneHash,
      env: TEST_ENV,
    }),
    first.session.sessionToken,
  );
}

function assertSecretPolicy(): void {
  assert.throws(
    () =>
      resolveWheelHmacSecret({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WheelSecretError,
  );
  assert.throws(
    () =>
      resolveWheelHmacSecret({
        NODE_ENV: "production",
        WHEEL_OF_FORTUNE_CAMPAIGN_SECRET: "too-short",
      } as NodeJS.ProcessEnv),
    (error: unknown) => error instanceof WheelSecretError,
  );
  assert.equal(
    resolveWheelHmacSecret({
      NODE_ENV: "production",
      AUTH_SECRET: "production-auth-secret",
    } as NodeJS.ProcessEnv),
    "production-auth-secret",
  );
}

function looksLikeProductionDatabaseUrl(url: string): boolean {
  return /prod|production|staging/i.test(url) && !/localhost|127\.0\.0\.1/i.test(url);
}

async function canReachPostgres(databaseUrl: string): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function resolveEphemeralPostgresUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
} | null> {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured && !looksLikeProductionDatabaseUrl(configured)) {
    if (await canReachPostgres(configured)) {
      return {
        databaseUrl: configured,
        cleanup: async () => undefined,
      };
    }
  }

  const { spawnSync } = await import("node:child_process");
  const dockerProbe = spawnSync("docker", ["info"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (dockerProbe.status !== 0) {
    return null;
  }

  const containerName = `wheel-attempt-pg-${Date.now()}`;
  const password = "wheel-attempt-test";
  const port = String(55432 + (Date.now() % 1000));
  const run = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=wheel_attempt",
      "-p",
      `${port}:5432`,
      "postgres:16-alpine",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (run.status !== 0) {
    console.log(
      "wheel-phone-attempt-db: PG cooldown proof SKIP (docker postgres start failed)",
    );
    return null;
  }

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/wheel_attempt`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await canReachPostgres(databaseUrl)) {
      return {
        databaseUrl,
        cleanup: async () => {
          spawnSync("docker", ["rm", "-f", containerName], {
            encoding: "utf8",
            timeout: 30_000,
          });
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  spawnSync("docker", ["rm", "-f", containerName], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return null;
}

async function assertPostgresCooldownConcurrencyProof(): Promise<void> {
  const ephemeral = await resolveEphemeralPostgresUrl();
  if (!ephemeral) {
    console.log(
      "wheel-phone-attempt-db: PG cooldown proof SKIP (no reachable non-prod Postgres; fake Prisma path still ran)",
    );
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: ephemeral.databaseUrl } },
  });
  const schema = `wheel_cooldown_proof_${Date.now()}`;

  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schema}".attempt_rows (
        id uuid PRIMARY KEY,
        game_catalog_id uuid NOT NULL,
        campaign_key_snapshot varchar(64) NOT NULL,
        participant_phone_hash varchar(64),
        attempt_id_hash varchar(64),
        browser_visitor_hash varchar(64),
        started_at timestamptz NOT NULL DEFAULT now(),
        server_assignment jsonb
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX attempt_rows_catalog_campaign_phone_started_idx
      ON "${schema}".attempt_rows (
        game_catalog_id,
        campaign_key_snapshot,
        participant_phone_hash,
        started_at DESC
      )
      WHERE participant_phone_hash IS NOT NULL
        AND campaign_key_snapshot IS NOT NULL
    `);

    // Apply cooldown migration DDL against a table shaped like game_sessions
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${schema}".game_sessions (
        id uuid PRIMARY KEY,
        game_catalog_id uuid NOT NULL,
        campaign_key_snapshot varchar(64),
        participant_phone_hash varchar(64),
        started_at timestamptz NOT NULL DEFAULT now(),
        token_hash varchar(64) UNIQUE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "game_sessions_catalog_campaign_phone_hash_uidx"
      ON "${schema}".game_sessions (
        game_catalog_id,
        campaign_key_snapshot,
        participant_phone_hash
      )
      WHERE participant_phone_hash IS NOT NULL
        AND campaign_key_snapshot IS NOT NULL
    `);
    const historyId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".game_sessions (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash, started_at, token_hash
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6)`,
      historyId,
      CATALOG_A,
      "permanent-wheel",
      "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      new Date("2026-08-01T10:00:00.000Z").toISOString(),
      createHash("sha256").update("history-token").digest("hex"),
    );

    // Apply the same DDL as the cooldown migration (schema-qualified).
    await prisma.$executeRawUnsafe(
      `DROP INDEX IF EXISTS "${schema}"."game_sessions_catalog_campaign_phone_hash_uidx"`,
    );
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_started_idx"
      ON "${schema}".game_sessions (
        "game_catalog_id",
        "campaign_key_snapshot",
        "participant_phone_hash",
        "started_at" DESC
      )
      WHERE "participant_phone_hash" IS NOT NULL
        AND "campaign_key_snapshot" IS NOT NULL
    `);

    const migrationSql = fs.readFileSync(
      path.join(
        ROOT,
        "prisma/migrations/20260804180000_wheel_phone_replay_cooldown/migration.sql",
      ),
      "utf8",
    );
    assert.match(
      migrationSql,
      /DROP INDEX IF EXISTS "game_sessions_catalog_campaign_phone_hash_uidx"/,
    );
    assert.match(
      migrationSql,
      /CREATE INDEX IF NOT EXISTS "game_sessions_catalog_campaign_phone_started_idx"/,
    );

    const indexes = await prisma.$queryRawUnsafe<
      Array<{ indexname: string }>
    >(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'game_sessions'`,
      schema,
    );
    const indexNames = indexes.map((row) => row.indexname);
    assert.ok(
      !indexNames.includes("game_sessions_catalog_campaign_phone_hash_uidx"),
      "lifetime unique index must be dropped",
    );
    assert.ok(
      indexNames.includes("game_sessions_catalog_campaign_phone_started_idx"),
      "lookup index must exist",
    );
    const preserved = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM "${schema}".game_sessions WHERE id = $1::uuid`,
      historyId,
    );
    assert.equal(preserved.length, 1, "historical rows must be preserved");

    // token_hash unique must remain
    await assert.rejects(async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}".game_sessions (
          id, game_catalog_id, campaign_key_snapshot, participant_phone_hash, token_hash
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
        randomUUID(),
        CATALOG_A,
        "permanent-wheel",
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        createHash("sha256").update("history-token").digest("hex"),
      );
    });

    const catalogId = CATALOG_A;
    const campaign = "permanent-wheel";
    const phoneHash = hashParticipantPhone({
      normalizedPhone: "79991234567",
      gameCatalogId: catalogId,
      campaignKeySnapshot: campaign,
      env: TEST_ENV,
    });
    const lockKey = buildWheelPhoneParticipantLockKey({
      gameCatalogId: catalogId,
      campaignKeySnapshot: campaign,
      participantPhoneHash: phoneHash,
    });

    const insertWithLock = async (attemptId: string, sector: number) => {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock($1::bigint)`,
          lockKey.toString(),
        );
        const latest = await tx.$queryRawUnsafe<
          Array<{ started_at: Date }>
        >(
          `SELECT started_at FROM "${schema}".attempt_rows
           WHERE game_catalog_id = $1::uuid
             AND campaign_key_snapshot = $2
             AND participant_phone_hash = $3
           ORDER BY started_at DESC
           LIMIT 1`,
          catalogId,
          campaign,
          phoneHash,
        );
        const now = new Date();
        if (
          latest[0] &&
          now.getTime() <
            latest[0].started_at.getTime() + WHEEL_REPLAY_COOLDOWN_MS
        ) {
          return { created: false as const, sector: null };
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schema}".attempt_rows (
            id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
            attempt_id_hash, browser_visitor_hash, started_at, server_assignment
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
          randomUUID(),
          catalogId,
          campaign,
          phoneHash,
          attemptId,
          `visitor-${attemptId}`,
          now.toISOString(),
          JSON.stringify({ sectorIndex: sector }),
        );
        return { created: true as const, sector };
      });
    };

    // Seed an expired session so cooldown has ended
    const past = new Date(Date.now() - WHEEL_REPLAY_COOLDOWN_MS - 1000);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, started_at, server_assignment
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
      randomUUID(),
      catalogId,
      campaign,
      phoneHash,
      "seed-attempt",
      "seed-visitor",
      past.toISOString(),
      JSON.stringify({ sectorIndex: 0 }),
    );

    const results = await Promise.all([
      insertWithLock("attempt-a", 3),
      insertWithLock("attempt-b", 11),
    ]);
    const created = results.filter((row) => row.created);
    const blocked = results.filter((row) => !row.created);
    assert.equal(created.length, 1, "exactly one concurrent winner after cooldown");
    assert.equal(blocked.length, 1, "loser must see cooldown");

    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${schema}".attempt_rows
       WHERE participant_phone_hash = $1 AND attempt_id_hash <> 'seed-attempt'`,
      phoneHash,
    );
    assert.equal(Number(countRows[0]?.count ?? 0), 1);

    // Historical seed row must still exist
    const history = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${schema}".attempt_rows
       WHERE attempt_id_hash = 'seed-attempt'`,
    );
    assert.equal(Number(history[0]?.count ?? 0), 1);

    // Catch-Time style NULL phone hashes unrestricted
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, server_assignment
      ) VALUES ($1::uuid, $2::uuid, $3, NULL, NULL, NULL, '{}'::jsonb)`,
      randomUUID(),
      catalogId,
      campaign,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, server_assignment
      ) VALUES ($1::uuid, $2::uuid, $3, NULL, NULL, NULL, '{}'::jsonb)`,
      randomUUID(),
      catalogId,
      campaign,
    );

    console.log("wheel-phone-attempt-db: PG cooldown proof PASS");
  } finally {
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch {
      // ignore cleanup failures
    }
    await prisma.$disconnect().catch(() => undefined);
    await ephemeral.cleanup();
  }
}

async function main(): Promise<void> {
  assertServiceSourceContracts();
  assertPhoneNormalization();
  assertSecretPolicy();
  await assertFakePrismaRegistration();
  await assertPostgresCooldownConcurrencyProof();
  console.log("security-wheel-phone-attempt-db-check: OK");
}

main().catch((error) => {
  console.error("security-wheel-phone-attempt-db-check: FAILED");
  console.error(error);
  process.exit(1);
});
