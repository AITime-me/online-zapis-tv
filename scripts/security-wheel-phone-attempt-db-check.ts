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
import { normalizeGameBookingPhoneKey } from "../src/lib/game/game-open-request-policy";
import { normalizePhone } from "../src/lib/phone/normalize-phone";

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

function assignment(sectorIndex: number): WheelServerAssignmentV1 {
  return {
    version: 1,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverResultTier: 0,
    campaignKey: "permanent-wheel",
    rulesVersion: "1",
    assignedAt: "2026-08-03T10:00:00.000Z",
    tierBucket: "tier-0",
    sectorIndex,
    totalSectors: 16,
    prizeSystemKey: `prize-${sectorIndex}`,
    giftId: `00000000-0000-4000-8000-${String(sectorIndex).padStart(12, "0")}`,
  };
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
  assert.match(source, /gameSession\.create/);
  assert.match(source, /isPrismaUniqueViolation|P2002/);
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

  const createIndex = source.indexOf("gameSession.create");
  const findIndex = source.indexOf("gameSession.findFirst");
  assert.ok(createIndex > 0, "must call gameSession.create");
  assert.ok(findIndex > createIndex, "INSERT must appear before conflict lookup");

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
  serverAssignment: unknown;
  createOrder: number;
};

function createFakePrisma() {
  const rows: FakeRow[] = [];
  let createOrder = 0;
  let createCalls = 0;
  let updateCalls = 0;

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
        serverAssignment: unknown;
      };
      select: Record<string, boolean>;
    }) {
      createCalls += 1;
      createOrder += 1;
      const data = args.data;

      const phoneConflict = rows.find(
        (row) =>
          row.gameCatalogId === data.gameCatalogId &&
          row.campaignKeySnapshot === data.campaignKeySnapshot &&
          row.participantPhoneHash === data.participantPhoneHash,
      );
      if (phoneConflict) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
          meta: {
            target: [
              "game_catalog_id",
              "campaign_key_snapshot",
              "participant_phone_hash",
            ],
          },
        });
      }

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
    }) {
      const where = args.where;
      const found = rows.find((row) => {
        if (
          where.gameCatalogId &&
          where.campaignKeySnapshot &&
          where.participantPhoneHash
        ) {
          return (
            row.gameCatalogId === where.gameCatalogId &&
            row.campaignKeySnapshot === where.campaignKeySnapshot &&
            row.participantPhoneHash === where.participantPhoneHash
          );
        }
        if (where.tokenHash) {
          return row.tokenHash === where.tokenHash;
        }
        return false;
      });
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
          }
        : null;
    },

    async update() {
      updateCalls += 1;
      throw new Error("gameSession.update must not be called");
    },
  };

  return {
    db: { gameSession } as unknown as PrismaClient,
    rows,
    getCreateCalls: () => createCalls,
    getUpdateCalls: () => updateCalls,
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
  assert.equal(fake.getCreateCalls(), 2);
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
    throw new Error("expected PHONE_ATTEMPT_EXISTS");
  }
  assert.equal(thirdFormat.error, "PHONE_ATTEMPT_EXISTS");
  assert.equal(fake.rows.length, 1);

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
      "wheel-phone-attempt-db: PG unique proof SKIP (docker postgres start failed)",
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

async function assertPostgresUniqueIndexProof(): Promise<void> {
  const ephemeral = await resolveEphemeralPostgresUrl();
  if (!ephemeral) {
    console.log(
      "wheel-phone-attempt-db: PG unique proof SKIP (no reachable non-prod Postgres; fake Prisma P2002 path still ran)",
    );
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: ephemeral.databaseUrl } },
  });
  const schema = `wheel_attempt_proof_${Date.now()}`;

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
        server_assignment jsonb
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX attempt_rows_catalog_campaign_phone_uidx
      ON "${schema}".attempt_rows (
        game_catalog_id,
        campaign_key_snapshot,
        participant_phone_hash
      )
      WHERE participant_phone_hash IS NOT NULL
        AND campaign_key_snapshot IS NOT NULL
    `);

    const catalogId = CATALOG_A;
    const campaign = "permanent-wheel";
    const phoneHashes = PHONE_FORMATS.map((phone) =>
      hashParticipantPhone({
        normalizedPhone: normalizeGameBookingPhoneKey(phone)!,
        gameCatalogId: catalogId,
        campaignKeySnapshot: campaign,
        env: TEST_ENV,
      }),
    );
    assert.equal(phoneHashes[0], phoneHashes[1]);
    assert.equal(phoneHashes[0], phoneHashes[2]);

    const insertSql = `
      INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, server_assignment
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
    `;

    // Concurrent inserts with same phone hash from three formats → one row
    const winners = { count: 0 };
    const losers = { count: 0 };
    const winnerSector = { value: -1 };

    await Promise.all(
      PHONE_FORMATS.map(async (phone, index) => {
        try {
          await prisma.$executeRawUnsafe(
            insertSql,
            randomUUID(),
            catalogId,
            campaign,
            phoneHashes[index],
            `attempt-format-${index}`,
            `visitor-format-${index}`,
            JSON.stringify(assignment(index === 0 ? 3 : 11)),
          );
          winners.count += 1;
          winnerSector.value = index === 0 ? 3 : 11;
        } catch {
          losers.count += 1;
        }
      }),
    );

    assert.equal(winners.count, 1, "formatted phones must collide on unique index");
    assert.equal(losers.count, 2);

    const stored = await prisma.$queryRawUnsafe<
      Array<{ server_assignment: WheelServerAssignmentV1; count: bigint }>
    >(
      `SELECT server_assignment, COUNT(*)::bigint AS count
       FROM "${schema}".attempt_rows
       WHERE participant_phone_hash = $1
       GROUP BY server_assignment`,
      phoneHashes[0],
    );
    assert.equal(stored.length, 1);
    assert.equal(Number(stored[0]?.count ?? 0), 1);
    assert.equal(stored[0]?.server_assignment.sectorIndex, winnerSector.value);
    assert.ok(
      stored[0]?.server_assignment.sectorIndex === 3 ||
        stored[0]?.server_assignment.sectorIndex === 11,
    );

    // Race many identical hashes
    const racePhoneHash = "b".repeat(64);
    const raceWinners = { count: 0 };
    const raceLosers = { count: 0 };
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        try {
          await prisma.$executeRawUnsafe(
            insertSql,
            randomUUID(),
            catalogId,
            "race-campaign",
            racePhoneHash,
            `attempt-${index}`,
            `visitor-${index}`,
            JSON.stringify({ sectorIndex: index }),
          );
          raceWinners.count += 1;
        } catch {
          raceLosers.count += 1;
        }
      }),
    );
    assert.equal(raceWinners.count, 1);
    assert.equal(raceLosers.count, 11);

    // NULL phone hash rows (Catch-Time style) are not constrained by partial index
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, server_assignment
      ) VALUES (
        $1::uuid, $2::uuid, $3, NULL, NULL, NULL, '{}'::jsonb
      )
    `,
      randomUUID(),
      catalogId,
      campaign,
    );
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "${schema}".attempt_rows (
        id, game_catalog_id, campaign_key_snapshot, participant_phone_hash,
        attempt_id_hash, browser_visitor_hash, server_assignment
      ) VALUES (
        $1::uuid, $2::uuid, $3, NULL, NULL, NULL, '{}'::jsonb
      )
    `,
      randomUUID(),
      catalogId,
      campaign,
    );

    console.log("wheel-phone-attempt-db: PG unique proof PASS");
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
  await assertPostgresUniqueIndexProof();
  console.log("security-wheel-phone-attempt-db-check: OK");
}

main().catch((error) => {
  console.error("security-wheel-phone-attempt-db-check: FAILED");
  console.error(error);
  process.exit(1);
});
