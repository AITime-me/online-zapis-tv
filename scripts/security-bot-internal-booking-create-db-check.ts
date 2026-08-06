/**
 * CURSOR-24 — PostgreSQL concurrency / idempotency races for bot booking create.
 *
 * Modes:
 *   default (non-gating): static checks always run; if Postgres unavailable,
 *     prints SKIPPED — NON-GATING MODE and does NOT claim race suite passed.
 *   --require-postgres: fail-closed; any skip/unavailable → exit 1.
 *
 * Package scripts:
 *   npm run test:security:bot-internal-booking-create-db
 *   npm run test:security:bot-internal-booking-create-db:required
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createBotBookingCreatePgFixture,
  nextFixturePhone,
  fixtureClientName,
} from "./lib/bot-booking-create-pg-fixture";
import { resolveBotBookingCreateRaceEligibility } from "./lib/bot-booking-create-db-race-eligibility";
import { assertDisposableBotBookingTestDatabase } from "./lib/bot-booking-create-test-db-guard";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

// Must run before any dynamic import of production server-only modules.
installServerOnlyShimForSecurityScripts();

const ROOT = process.cwd();
const REQUIRE_POSTGRES = process.argv.includes("--require-postgres");

type Outcome = "PASSED" | "SKIPPED" | "FAILED";
const outcomes: Array<{ name: string; outcome: Outcome; detail?: string }> = [];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function record(
  name: string,
  outcome: Outcome,
  detail?: string,
): void {
  outcomes.push({ name, outcome, detail });
}

function failClosed(name: string, detail: string): never {
  record(name, "FAILED", detail);
  throw new Error(`${name}: ${detail}`);
}

const HMAC_SECRET =
  "c24-ci-bot-idempotency-hmac-secret-32b-min!!";
const HMAC_PREVIOUS =
  "c24-ci-bot-idempotency-hmac-previous-32b-min!";

function ensureTestHmacEnv(): void {
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_SECRET;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
}

function testStaticInvariants(): void {
  const sql = read(
    "prisma/migrations/20260806120000_internal_bot_booking_create/migration.sql",
  );
  assert.match(sql, /internal_bot_booking_operations/);
  assert.match(sql, /internal_bot_booking_ops_kind_key_uidx/);
  assert.match(sql, /ADD VALUE 'BOT'/);

  const dbScript = read("scripts/security-bot-internal-booking-create-db-check.ts");
  assert.match(dbScript, /--require-postgres/);
  assert.match(dbScript, /SKIPPED — NON-GATING MODE/);
  assert.doesNotMatch(
    dbScript,
    new RegExp("full race SKIPPED" + " — requires seeded fixture"),
  );
  assert.match(dbScript, /assertDisposableBotBookingTestDatabase/);
  assert.match(dbScript, /resolveBotBookingCreateRaceEligibility/);
  assert.match(dbScript, /installServerOnlyShimForSecurityScripts/);
  assert.match(dbScript, /testServerOnlyHarnessImports/);
  assert.match(dbScript, /createCountdownBarrier/);
  assert.match(dbScript, /beforeCreate|beforeSerializableWrite|beforeClientResolve|beforeZeroClientCreate/);

  const eligibilityLib = read(
    "scripts/lib/bot-booking-create-db-race-eligibility.ts",
  );
  assert.match(eligibilityLib, /assertDisposableBotBookingTestDatabase/);
  assert.match(eligibilityLib, /canQuery/);
  // Guard must be invoked before canQuery in the eligibility helper body order.
  assert.ok(
    eligibilityLib.indexOf("assertDisposableBotBookingTestDatabase") <
      eligibilityLib.indexOf("input.canQuery"),
  );

  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  const required =
    pkg.scripts["test:security:bot-internal-booking-create-db:required"];
  assert.ok(required, "required package script missing");
  assert.match(required, /--require-postgres/);
  assert.doesNotMatch(required, /RUN_BOT_BOOKING_CREATE_DB_TESTS/);

  const hmac = read("src/lib/bot-api/booking-create-idempotency-hmac.ts");
  assert.doesNotMatch(
    hmac,
    /process\.env\.(AUTH_SECRET|NEXTAUTH_SECRET|BOT_INTERNAL_API_TOKEN)/,
  );
  assert.doesNotMatch(
    read("src/lib/bot-api/booking-create-idempotency.ts"),
    /process\.env\.(AUTH_SECRET|NEXTAUTH_SECRET)|hmac-fallback/,
  );

  // Production modules must keep the server-only boundary (shim is test-only).
  assert.match(
    read("src/services/BotBookingCreateService.ts"),
    /import "server-only"/,
  );
  assert.match(
    read("src/lib/bot-api/booking-create-idempotency.ts"),
    /import "server-only"/,
  );
  assert.match(
    read("src/lib/bot-api/booking-create-idempotency-hmac.ts"),
    /import "server-only"/,
  );

  record("static-invariants", "PASSED");
}

/**
 * Prove tsx + security shim can load production server modules used by races.
 * Runs in both non-gating and required modes (before eligibility / canQuery).
 */
async function testServerOnlyHarnessImports(): Promise<void> {
  installServerOnlyShimForSecurityScripts();

  // Do not $disconnect — race suite reuses the src/lib/db singleton when eligible.
  const db = await import("../src/lib/db");
  assert.ok(db.prisma);

  const service = await import("../src/services/BotBookingCreateService");
  assert.equal(typeof service.createBotConfirmedBooking, "function");

  record("server-only-harness-imports", "PASSED");
}

async function canQuery(databaseUrl: string): Promise<boolean> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return true;
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryUntilSettled<T>(
  fn: () => Promise<T>,
  isRetryable: (value: T) => boolean,
  attempts = 12,
  delayMs = 50,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (!isRetryable(last)) {
      return last;
    }
    await sleep(delayMs);
  }
  assert.ok(last !== undefined);
  return last;
}

async function runRequiredRaceSuite(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    failClosed("postgres-env", "DATABASE_URL missing");
  }

  // Fail-closed before any fixture mutation (including against tvoe_vremya).
  try {
    assertDisposableBotBookingTestDatabase(databaseUrl);
  } catch (error) {
    failClosed(
      "test-database-guard",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!(await canQuery(databaseUrl))) {
    failClosed("postgres-reachability", "PostgreSQL unreachable");
  }

  ensureTestHmacEnv();

  const { prisma } = await import("../src/lib/db");
  const {
    createBotConfirmedBooking,
    setBotBookingCreateTestHooks,
    clearBotBookingCreateTestHooks,
    createCountdownBarrier,
  } = await import("../src/services/BotBookingCreateService");
  const {
    claimBotBookingIdempotency,
    computeBotBookingRequestFingerprint,
    computeBotBookingRequestFingerprintCandidates,
  } = await import("../src/lib/bot-api/booking-create-idempotency");
  const { normalizePhone } = await import("../src/lib/phone/normalize-phone");

  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'internal_bot_booking_operations'`,
  );
  if (tables.length !== 1) {
    failClosed(
      "postgres-migration",
      "migration not applied (internal_bot_booking_operations missing)",
    );
  }

  const trackedKeys: string[] = [];
  const fixture = await createBotBookingCreatePgFixture(prisma);

  try {
    // --- Race A: same key, same payload (barrier at claim) ---
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const phone = nextFixturePhone(fixture.runId, 1);
      const body = {
        idempotencyKey: key,
        slotId: fixture.slotId,
        clientName: fixtureClientName(fixture.runId, "A"),
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
      };

      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeCreate: () => barrier.wait(),
      });

      try {
        const createWithRetry = () =>
          retryUntilSettled(
            () => createBotConfirmedBooking(body),
            (v) => !v.ok && v.code === "IDEMPOTENCY_IN_PROGRESS",
          );

        const settled = await Promise.all([
          createWithRetry(),
          createWithRetry(),
        ]);

        const successes = settled.filter((r) => r.ok);
        assert.equal(successes.length, 2, "Race A: both must succeed after retry");
        assert.ok(successes[0]?.ok && successes[1]?.ok);
        if (successes[0].ok && successes[1].ok) {
          assert.equal(
            successes[0].body.bookingId,
            successes[1].body.bookingId,
          );
        }

        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId, serviceId: fixture.serviceId },
        });
        assert.equal(apptCount, 1, "Race A: exactly one Appointment");

        const opCount = await prisma.internalBotBookingOperation.count({
          where: { idempotencyKey: key },
        });
        assert.equal(opCount, 1, "Race A: exactly one idempotency operation");

        record("race-a-same-key-same-payload", "PASSED");
      } finally {
        clearBotBookingCreateTestHooks();
        barrier.cancel();
      }
    }

    // Clean appointments between races that need empty slot (keep fixture catalog).
    await prisma.legalAcceptanceRecord.deleteMany({
      where: {
        appointment: { masterId: fixture.masterId },
      },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race B: same key, different payload ---
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const phone = nextFixturePhone(fixture.runId, 2);
      const base = {
        idempotencyKey: key,
        slotId: fixture.slotId,
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
      };
      const a = {
        ...base,
        clientName: fixtureClientName(fixture.runId, "B1"),
      };
      const b = {
        ...base,
        clientName: fixtureClientName(fixture.runId, "B2"),
      };

      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeCreate: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          createBotConfirmedBooking(a),
          createBotConfirmedBooking(b),
        ]);

        const successes = results.filter((r) => r.ok);
        const conflicts = results.filter(
          (r) => !r.ok && r.code === "IDEMPOTENCY_CONFLICT",
        );
        assert.equal(successes.length, 1, "Race B: one winner");
        assert.equal(conflicts.length, 1, "Race B: one IDEMPOTENCY_CONFLICT");

        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        });
        assert.equal(apptCount, 1, "Race B: at most one Appointment");

        const opCount = await prisma.internalBotBookingOperation.count({
          where: { idempotencyKey: key },
        });
        assert.equal(opCount, 1);

        record("race-b-same-key-diff-payload", "PASSED");
      } finally {
        clearBotBookingCreateTestHooks();
        barrier.cancel();
      }
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race C: different keys, same slot ---
    {
      const key1 = randomUUID();
      const key2 = randomUUID();
      trackedKeys.push(key1, key2);
      const phone1 = nextFixturePhone(fixture.runId, 3);
      const phone2 = nextFixturePhone(fixture.runId, 4);

      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          createBotConfirmedBooking({
            idempotencyKey: key1,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "C1"),
            phone: phone1,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
          createBotConfirmedBooking({
            idempotencyKey: key2,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "C2"),
            phone: phone2,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        ]);

        const successes = results.filter((r) => r.ok);
        const losers = results.filter(
          (r) =>
            !r.ok &&
            (r.code === "SLOT_NO_LONGER_AVAILABLE" ||
              r.code === "BOOKING_CONFLICT"),
        );
        assert.equal(successes.length, 1, "Race C: exactly one success");
        assert.equal(losers.length, 1, "Race C: loser conflict code");

        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        });
        assert.equal(apptCount, 1, "Race C: interval row count = 1");

        record("race-c-diff-keys-same-slot", "PASSED");
      } finally {
        clearBotBookingCreateTestHooks();
        barrier.cancel();
      }
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race D: overlapping intervals ---
    {
      const key1 = randomUUID();
      const key2 = randomUUID();
      trackedKeys.push(key1, key2);
      const phone1 = nextFixturePhone(fixture.runId, 5);
      const phone2 = nextFixturePhone(fixture.runId, 6);

      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          createBotConfirmedBooking({
            idempotencyKey: key1,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "D1"),
            phone: phone1,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
          createBotConfirmedBooking({
            idempotencyKey: key2,
            slotId: fixture.overlapSlotId,
            clientName: fixtureClientName(fixture.runId, "D2"),
            phone: phone2,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        ]);

        const successes = results.filter((r) => r.ok);
        const losers = results.filter(
          (r) =>
            !r.ok &&
            (r.code === "SLOT_NO_LONGER_AVAILABLE" ||
              r.code === "BOOKING_CONFLICT"),
        );
        assert.equal(successes.length, 1, "Race D: exactly one success");
        assert.equal(losers.length, 1, "Race D: overlap loser");

        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        });
        assert.equal(apptCount, 1, "Race D: one appointment interval");

        record("race-d-overlapping-intervals", "PASSED");
      } finally {
        clearBotBookingCreateTestHooks();
        barrier.cancel();
      }
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race E: concurrent zero-client resolution ---
    {
      const key1 = randomUUID();
      const key2 = randomUUID();
      trackedKeys.push(key1, key2);
      const phone = nextFixturePhone(fixture.runId, 7);
      const normalized = normalizePhone(phone);
      assert.ok(normalized);

      const before = await prisma.client.count({
        where: { normalizedPhone: normalized },
      });
      assert.equal(before, 0, "Race E: start with zero clients");

      // Sync immediately before advisory lock (not after: lock would serialize waiters).
      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeClientResolve: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          createBotConfirmedBooking({
            idempotencyKey: key1,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "E1"),
            phone,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
          createBotConfirmedBooking({
            idempotencyKey: key2,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "E2"),
            phone,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        ]);

        const clientCount = await prisma.client.count({
          where: { normalizedPhone: normalized },
        });
        assert.equal(clientCount, 1, "Race E: exactly one Client");

        const clients = await prisma.client.findMany({
          where: { normalizedPhone: normalized },
          select: { id: true },
        });
        assert.equal(clients.length, 1);

        const appts = await prisma.appointment.findMany({
          where: { masterId: fixture.masterId },
          select: { clientId: true },
        });
        assert.equal(appts.length, 1);
        assert.equal(appts[0]?.clientId, clients[0]?.id);

        assert.ok(
          results.some((r) => r.ok) ||
            results.some(
              (r) =>
                !r.ok &&
                (r.code === "SLOT_NO_LONGER_AVAILABLE" ||
                  r.code === "BOOKING_CONFLICT"),
            ),
        );

        record("race-e-concurrent-zero-client", "PASSED");
      } finally {
        clearBotBookingCreateTestHooks();
        barrier.cancel();
      }
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race F: crash/replay equivalent ---
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const phone = nextFixturePhone(fixture.runId, 8);
      const body = {
        idempotencyKey: key,
        slotId: fixture.slotId,
        clientName: fixtureClientName(fixture.runId, "F"),
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
      };

      const first = await createBotConfirmedBooking(body);
      assert.equal(first.ok, true);
      if (!first.ok) throw new Error("Race F first failed");

      const replay = await createBotConfirmedBooking(body);
      assert.equal(replay.ok, true);
      if (!replay.ok) throw new Error("Race F replay failed");
      assert.equal(replay.body.idempotentReplay, true);
      assert.equal(replay.body.bookingId, first.body.bookingId);

      const apptCount = await prisma.appointment.count({
        where: { masterId: fixture.masterId },
      });
      assert.equal(apptCount, 1, "Race F: appointment count remains 1");

      const op = await prisma.internalBotBookingOperation.findUnique({
        where: {
          operationKind_idempotencyKey: {
            operationKind: "bot.booking.create.v1",
            idempotencyKey: key,
          },
        },
      });
      assert.equal(op?.state, "SUCCEEDED");

      record("race-f-crash-replay", "PASSED");
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });

    // --- Race G: forced in-tx rollback ---
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const phone = nextFixturePhone(fixture.runId, 9);
      const normalized = normalizePhone(phone);
      assert.ok(normalized);

      setBotBookingCreateTestHooks({ afterClientResolve: () => { throw new Error("C24_FORCED_TX_ROLLBACK"); } });

      try {
        const result = await createBotConfirmedBooking({
          idempotencyKey: key,
          slotId: fixture.slotId,
          clientName: fixtureClientName(fixture.runId, "G"),
          phone,
          personalDataConsent: true,
          offerAcknowledgement: true,
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.code, "INTERNAL_ERROR");
        }
      } finally {
        clearBotBookingCreateTestHooks();
      }

      assert.equal(
        await prisma.client.count({ where: { normalizedPhone: normalized } }),
        0,
        "Race G: 0 partial Client",
      );
      assert.equal(
        await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        }),
        0,
        "Race G: 0 Appointment",
      );
      assert.equal(
        await prisma.legalAcceptanceRecord.count({
          where: {
            appointment: { masterId: fixture.masterId },
          },
        }),
        0,
        "Race G: 0 LegalAcceptance",
      );

      const op = await prisma.internalBotBookingOperation.findUnique({
        where: {
          operationKind_idempotencyKey: {
            operationKind: "bot.booking.create.v1",
            idempotencyKey: key,
          },
        },
      });
      assert.ok(op);
      assert.notEqual(op.state, "SUCCEEDED");
      assert.equal(op.resultSnapshot, null);

      record("race-g-rollback", "PASSED");
    }

    // --- Rotation: claim-level fingerprint match across previous secret ---
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const phone = nextFixturePhone(fixture.runId, 10);
      const input = {
        slotId: fixture.slotId,
        clientName: fixtureClientName(fixture.runId, "R"),
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
      };

      process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_PREVIOUS;
      delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
      const oldFp = computeBotBookingRequestFingerprint(input);

      await prisma.internalBotBookingOperation.create({
        data: {
          operationKind: "bot.booking.create.v1",
          idempotencyKey: key,
          requestFingerprint: oldFp,
          state: "SUCCEEDED",
          resultSnapshot: {
            bookingId: randomUUID(),
            slotId: fixture.slotId,
            status: "SCHEDULED",
            startsAt: `${fixture.dateKey}T14:00:00+05:00`,
          },
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_SECRET;
      process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS = HMAC_PREVIOUS;
      const { current, candidates } =
        computeBotBookingRequestFingerprintCandidates(input);
      const replay = await claimBotBookingIdempotency(prisma, {
        idempotencyKey: key,
        fingerprint: current,
        matchFingerprints: candidates,
      });
      assert.equal(replay.kind, "replay_success");

      process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_SECRET;
      delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
      const { current: currentOnly, candidates: candidatesOnly } =
        computeBotBookingRequestFingerprintCandidates(input);
      const missingPrevious = await claimBotBookingIdempotency(prisma, {
        idempotencyKey: key,
        fingerprint: currentOnly,
        matchFingerprints: candidatesOnly,
      });
      assert.equal(missingPrevious.kind, "conflict");

      record("race-rotation-claim-replay", "PASSED");
    }

    // Ensure no SKIPPED outcomes were recorded in required mode
    if (outcomes.some((o) => o.outcome === "SKIPPED")) {
      failClosed("required-mode-skip-forbidden", "SKIPPED outcome in required mode");
    }
  } finally {
    clearBotBookingCreateTestHooks();
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    await fixture.cleanup();
    await prisma.$disconnect().catch(() => undefined);
  }
}

function printOutcomes(): void {
  for (const row of outcomes) {
    console.log(
      `${row.outcome}: ${row.name}${row.detail ? ` (${row.detail})` : ""}`,
    );
  }
}

async function main(): Promise<void> {
  testStaticInvariants();
  await testServerOnlyHarnessImports();

  const databaseUrl = process.env.DATABASE_URL?.trim();

  // Guard (and missing-URL policy) before canQuery / Prisma / any DB I/O.
  const eligibility = await resolveBotBookingCreateRaceEligibility({
    databaseUrl,
    requirePostgres: REQUIRE_POSTGRES,
    canQuery,
  });

  if (eligibility.kind === "fail") {
    record(
      eligibility.code === "MISSING_DATABASE_URL"
        ? "postgres-env"
        : eligibility.code === "POSTGRES_UNREACHABLE"
          ? "postgres-reachability"
          : "test-database-guard",
      "FAILED",
      eligibility.detail,
    );
    printOutcomes();
    console.log(
      "security-bot-internal-booking-create-db-check: REQUIRED MODE FAILED",
    );
    process.exit(1);
  }

  if (eligibility.kind === "skip") {
    console.log(`SKIPPED — NON-GATING MODE (${eligibility.detail})`);
    console.log(
      "Concurrency NOT proven — PostgreSQL race suite was not executed.",
    );
    printOutcomes();
    console.log(
      "security-bot-internal-booking-create-db-check: STATIC OK; RACES NOT RUN",
    );
    return;
  }

  try {
    await runRequiredRaceSuite();
  } catch (error) {
    if (!outcomes.some((o) => o.outcome === "FAILED")) {
      record(
        "postgres-race-suite",
        "FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
    printOutcomes();
    if (REQUIRE_POSTGRES) {
      console.log(
        "security-bot-internal-booking-create-db-check: REQUIRED MODE FAILED",
      );
    }
    process.exit(1);
  }

  printOutcomes();
  if (REQUIRE_POSTGRES) {
    if (outcomes.some((o) => o.outcome === "FAILED" || o.outcome === "SKIPPED")) {
      process.exit(1);
    }
    console.log(
      "security-bot-internal-booking-create-db-check: REQUIRED MODE OK",
    );
    return;
  }

  if (outcomes.some((o) => o.outcome === "FAILED")) {
    process.exit(1);
  }
  console.log(
    "security-bot-internal-booking-create-db-check: OK (races executed)",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
