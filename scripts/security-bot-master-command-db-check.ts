/**
 * CURSOR-26 — PostgreSQL concurrency / ownership races for Master Command API.
 *
 * Modes:
 *   default (non-gating): static checks always; disposable DB required for races.
 *   --require-postgres: fail-closed.
 *
 * Does NOT substitute a non-disposable DB (e.g. local tvoe_vremya).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createBotBookingCreatePgFixture,
  fixtureClientName,
  nextFixturePhone,
} from "./lib/bot-booking-create-pg-fixture";
import { resolveBotBookingCreateRaceEligibility } from "./lib/bot-booking-create-db-race-eligibility";
import {
  assertMasterCommandRequiredPgGateWired,
  BOT_BOOKING_CREATE_CI_WORKFLOW_PATH,
  MASTER_COMMAND_REQUIRED_GATE_STEP_NAME,
  MASTER_COMMAND_REQUIRED_NPM,
  runTextExecutesExactNpmCommand,
} from "./lib/bot-booking-create-ci-wiring";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

installServerOnlyShimForSecurityScripts();

const ROOT = process.cwd();
const REQUIRE_POSTGRES = process.argv.includes("--require-postgres");

type Outcome = "PASSED" | "SKIPPED" | "FAILED";
const outcomes: Array<{ name: string; outcome: Outcome; detail?: string }> = [];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function record(name: string, outcome: Outcome, detail?: string): void {
  outcomes.push({ name, outcome, detail });
}

function failClosed(name: string, detail: string): never {
  record(name, "FAILED", detail);
  throw new Error(`${name}: ${detail}`);
}

const HMAC_SECRET = "c26-ci-bot-idempotency-hmac-secret-32b-min!!";

function ensureTestHmacEnv(): void {
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_SECRET;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
}

function testStaticInvariants(): void {
  const sql = read(
    "prisma/migrations/20260807120000_master_command_api/migration.sql",
  );
  assert.match(sql, /ScheduleResourceOrigin/);
  assert.match(sql, /BOT_MASTER_COMMAND/);
  assert.match(sql, /schedule_blocks/);
  assert.match(sql, /extra_work_windows/);

  const service = read("src/services/MasterCommandService.ts");
  assert.match(service, /runSerializableAppointmentWrite/);
  assert.match(service, /createCountdownBarrier/);
  assert.match(service, /BOT_MASTER_COMMAND/);

  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  assert.ok(pkg.scripts["test:security:bot-master-command"]);
  assert.ok(pkg.scripts["test:security:bot-master-command-db"]);
  assert.match(
    pkg.scripts["test:security:bot-master-command-db:required"] ?? "",
    /--require-postgres/,
  );

  const workflow = read(BOT_BOOKING_CREATE_CI_WORKFLOW_PATH);
  assertMasterCommandRequiredPgGateWired(workflow);
  assert.match(
    workflow,
    /src\/app\/api\/internal\/bot\/v1\/master\/\*\*/,
    "workflow path filters must include master command routes",
  );

  // Negative proofs: comment/echo/if/continue-on-error must not satisfy wiring.
  assert.throws(
    () =>
      assertMasterCommandRequiredPgGateWired(`
name: x
jobs:
  j:
    steps:
      - name: ${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}
        run: echo "${MASTER_COMMAND_REQUIRED_NPM}"
`),
    /must execute/,
  );
  assert.throws(
    () =>
      assertMasterCommandRequiredPgGateWired(`
name: x
jobs:
  j:
    steps:
      - name: note
        run: |
          # ${MASTER_COMMAND_REQUIRED_NPM}
          echo hi
      - name: ${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}
        run: echo skipped
`),
    /must execute/,
  );
  assert.throws(
    () =>
      assertMasterCommandRequiredPgGateWired(`
name: x
jobs:
  j:
    steps:
      - name: ${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}
        if: false
        run: ${MASTER_COMMAND_REQUIRED_NPM}
`),
    /if-condition/,
  );
  assert.throws(
    () =>
      assertMasterCommandRequiredPgGateWired(`
name: x
jobs:
  j:
    steps:
      - name: ${MASTER_COMMAND_REQUIRED_GATE_STEP_NAME}
        continue-on-error: true
        run: ${MASTER_COMMAND_REQUIRED_NPM}
`),
    /continue-on-error/,
  );

  const echoed = workflow.replace(
    MASTER_COMMAND_REQUIRED_NPM,
    `echo "${MASTER_COMMAND_REQUIRED_NPM}"`,
  );
  assert.throws(
    () => assertMasterCommandRequiredPgGateWired(echoed),
    /must execute/,
  );
  assert.equal(
    runTextExecutesExactNpmCommand(
      `echo "${MASTER_COMMAND_REQUIRED_NPM}"`,
      MASTER_COMMAND_REQUIRED_NPM,
    ),
    false,
  );

  record("static-invariants", "PASSED");
}

async function testServerOnlyHarnessImports(): Promise<void> {
  await import("../src/services/MasterCommandService");
  await import("../src/lib/bot-api/master-command-idempotency");
  record("server-only-harness-imports", "PASSED");
}

async function canQuery(databaseUrl: string): Promise<boolean> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await client.$queryRaw`SELECT 1`;
      return true;
    } finally {
      await client.$disconnect();
    }
  } catch {
    return false;
  }
}

async function runRaces(databaseUrl: string): Promise<void> {
  ensureTestHmacEnv();
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const {
    masterCloseInterval,
    masterDeleteBlock,
    masterCreateBooking,
    createCountdownBarrier,
    setMasterCommandTestHooks,
    clearMasterCommandTestHooks,
  } = await import("../src/services/MasterCommandService");
  const { createBotConfirmedBooking, setBotBookingCreateTestHooks, clearBotBookingCreateTestHooks } =
    await import("../src/services/BotBookingCreateService");

  const fixture = await createBotBookingCreatePgFixture(prisma);
  const trackedKeys: string[] = [];

  try {
    // Race A: booking create vs master close-interval on same slot
    {
      const keyBooking = randomUUID();
      const keyBlock = randomUUID();
      trackedKeys.push(keyBooking, keyBlock);
      const phone = nextFixturePhone(fixture.runId, 1);

      const barrier = createCountdownBarrier(2);
      setBotBookingCreateTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });
      setMasterCommandTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });

      try {
        const results = await Promise.all([
          createBotConfirmedBooking({
            idempotencyKey: keyBooking,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "A-book"),
            phone,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
          masterCloseInterval({
            idempotencyKey: keyBlock,
            masterId: fixture.masterId,
            dateKey: fixture.dateKey,
            startTime: fixture.startTime,
            endTime: "15:00",
            blockType: "PERSONAL",
          }),
        ]);

        const bookingOk = results[0].ok === true;
        const blockOk = results[1].ok === true;
        assert.equal(
          Number(bookingOk) + Number(blockOk),
          1,
          "Race A: exactly one of booking/block succeeds",
        );

        if (bookingOk && !blockOk && results[1].ok === false) {
          assert.equal(
            results[1].code,
            "APPOINTMENT_CONFLICT",
            `Race A block loser must be APPOINTMENT_CONFLICT, got ${results[1].code}`,
          );
          record("race-a-booking-vs-block", "PASSED");
        } else if (!bookingOk && blockOk && results[0].ok === false) {
          assert.ok(
            results[0].code === "SLOT_NO_LONGER_AVAILABLE",
            `Race A booking loser code: ${results[0].code}`,
          );
          record("race-a-booking-vs-block", "PASSED");
        } else {
          failClosed("race-a-booking-vs-block", "unexpected dual outcome");
        }

        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        });
        const blockCount = await prisma.scheduleBlock.count({
          where: {
            masterId: fixture.masterId,
            origin: "BOT_MASTER_COMMAND",
          },
        });
        assert.equal(
          apptCount + blockCount,
          1,
          "Race A: exactly one conflicting resource",
        );
      } finally {
        clearBotBookingCreateTestHooks();
        clearMasterCommandTestHooks();
        barrier.cancel();
      }
    }

    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.scheduleBlock.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;

    // Race B: idempotent replay of close-interval
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const body = {
        idempotencyKey: key,
        masterId: fixture.masterId,
        dateKey: fixture.dateKey,
        startTime: "21:00",
        endTime: "21:30",
        blockType: "PERSONAL" as const,
      };
      const first = await masterCloseInterval(body);
      assert.equal(first.ok, true);
      if (!first.ok) throw new Error("Race B first failed");

      const replay = await masterCloseInterval(body);
      assert.equal(replay.ok, true);
      if (!replay.ok) throw new Error("Race B replay failed");
      assert.equal(replay.body.idempotentReplay, true);
      assert.equal(replay.body.blockId, first.body.blockId);

      const count = await prisma.scheduleBlock.count({
        where: { masterId: fixture.masterId, origin: "BOT_MASTER_COMMAND" },
      });
      assert.equal(count, 1, "Race B: single block after replay");
      record("race-b-idempotent-replay", "PASSED");
    }

    // Race C: cannot delete ADMIN_UI block via master command
    {
      const { getStudioDayRangeFromDateKey } = await import(
        "../src/lib/datetime/studio"
      );
      const { parseStudioDateTime } = await import(
        "../src/lib/datetime/date-layer"
      );
      const { noteDate } = getStudioDayRangeFromDateKey(fixture.dateKey);
      const adminBlock = await prisma.scheduleBlock.create({
        data: {
          masterId: fixture.masterId,
          blockDate: noteDate,
          startsAt: parseStudioDateTime(fixture.dateKey, "10:00"),
          endsAt: parseStudioDateTime(fixture.dateKey, "10:30"),
          isFullDay: false,
          blockType: "PERSONAL",
          origin: "ADMIN_UI",
        },
      });
      const key = randomUUID();
      trackedKeys.push(key);
      const result = await masterDeleteBlock({
        idempotencyKey: key,
        masterId: fixture.masterId,
        blockId: adminBlock.id,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "BLOCK_NOT_OWNED");
      }
      const stillThere = await prisma.scheduleBlock.findUnique({
        where: { id: adminBlock.id },
      });
      assert.ok(stillThere, "Race C: ADMIN_UI block remains");
      record("race-c-admin-origin-not-deletable", "PASSED");
    }

    // Race D: master booking scoped create + conflict with second booking
    {
      await prisma.scheduleBlock.deleteMany({
        where: { masterId: fixture.masterId },
      });
      await prisma.appointment.deleteMany({
        where: { masterId: fixture.masterId },
      });

      const key1 = randomUUID();
      const key2 = randomUUID();
      trackedKeys.push(key1, key2);
      const phone1 = nextFixturePhone(fixture.runId, 2);
      const phone2 = nextFixturePhone(fixture.runId, 3);

      const barrier = createCountdownBarrier(2);
      setMasterCommandTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          masterCreateBooking({
            idempotencyKey: key1,
            masterId: fixture.masterId,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "D1"),
            phone: phone1,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
          masterCreateBooking({
            idempotencyKey: key2,
            masterId: fixture.masterId,
            slotId: fixture.slotId,
            clientName: fixtureClientName(fixture.runId, "D2"),
            phone: phone2,
            personalDataConsent: true,
            offerAcknowledgement: true,
          }),
        ]);
        const successes = results.filter((r) => r.ok);
        const losers = results.filter(
          (r) => !r.ok && r.code === "SLOT_NO_LONGER_AVAILABLE",
        );
        assert.equal(successes.length, 1, "Race D: one success");
        assert.equal(losers.length, 1, "Race D: one domain conflict");
        assert.equal(
          await prisma.appointment.count({
            where: { masterId: fixture.masterId },
          }),
          1,
        );
        record("race-d-master-booking-double", "PASSED");
      } finally {
        clearMasterCommandTestHooks();
        barrier.cancel();
      }
    }
  } finally {
    await prisma.legalAcceptanceRecord.deleteMany({
      where: { appointment: { masterId: fixture.masterId } },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.scheduleBlock.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    await prisma.client.deleteMany({
      where: { fullName: { startsWith: fixture.nameTag } },
    });
    await fixture.cleanup();
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  testStaticInvariants();
  await testServerOnlyHarnessImports();

  const eligibility = await resolveBotBookingCreateRaceEligibility({
    databaseUrl: process.env.DATABASE_URL,
    requirePostgres: REQUIRE_POSTGRES,
    canQuery,
  });

  if (eligibility.kind === "fail") {
    record("test-database-guard", "FAILED", eligibility.detail);
    console.error(
      `FAILED: test-database-guard (${eligibility.detail})`,
    );
    console.error("security-bot-master-command-db-check: REQUIRED MODE FAILED");
    process.exit(1);
  }

  if (eligibility.kind === "skip") {
    record("postgres-races", "SKIPPED", eligibility.detail);
    console.log(
      `SKIPPED — NON-GATING MODE (${eligibility.detail})`,
    );
    console.log(
      "Concurrency NOT proven — PostgreSQL race suite was not executed.",
    );
    for (const row of outcomes) {
      console.log(`${row.outcome}: ${row.name}${row.detail ? ` (${row.detail})` : ""}`);
    }
    console.log(
      "security-bot-master-command-db-check: STATIC OK; RACES NOT RUN",
    );
    process.exit(0);
  }

  record("test-database-guard", "PASSED");
  await runRaces(eligibility.databaseUrl);

  for (const row of outcomes) {
    console.log(`${row.outcome}: ${row.name}${row.detail ? ` (${row.detail})` : ""}`);
  }
  if (outcomes.some((o) => o.outcome === "FAILED")) {
    console.error("security-bot-master-command-db-check: FAILED");
    process.exit(1);
  }
  console.log("security-bot-master-command-db-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
