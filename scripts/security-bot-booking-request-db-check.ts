/**
 * BookingRequest contour — PostgreSQL integration / idempotency / races.
 *
 * Modes:
 *   default (non-gating): static checks always; disposable DB required for races.
 *   --require-postgres: fail-closed.
 *
 * Package scripts:
 *   npm run test:security:bot-booking-request-db
 *   npm run test:security:bot-booking-request-db:required
 *
 * Does NOT substitute a non-disposable DB (e.g. local tvoe_vremya).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveBotBookingCreateRaceEligibility } from "./lib/bot-booking-create-db-race-eligibility";
import {
  assertBookingRequestRequiredPgGateWired,
  assertBookingRequestStaticGateWired,
  BOT_BOOKING_CREATE_CI_WORKFLOW_PATH,
  BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME,
  BOOKING_REQUEST_REQUIRED_NPM,
  BOOKING_REQUEST_STATIC_GATE_STEP_NAME,
  BOOKING_REQUEST_STATIC_NPM,
  runTextExecutesExactNpmCommand,
} from "./lib/bot-booking-create-ci-wiring";
import {
  createBotBookingRequestPgFixture,
  nextFixturePhone,
} from "./lib/bot-booking-request-pg-fixture";
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

const HMAC_SECRET = "br-ci-bot-idempotency-hmac-secret-32b-min!!";

function ensureTestHmacEnv(): void {
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC_SECRET;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
}

function testStaticInvariants(): void {
  const service = read("src/services/BotBookingRequestService.ts");
  assert.match(service, /bookBotBookingRequest/);
  assert.match(service, /runSerializableAppointmentWrite/);
  assert.match(service, /createBotRequestAppointment/);
  assert.match(service, /RECONCILIATION_REQUIRED/);
  assert.match(service, /CONSULTATION_SERVICE_REQUIRED/);
  assert.match(service, /beforeSerializableWrite/);
  assert.match(service, /import "server-only"/);
  assert.doesNotMatch(service, /assertOnlineBookable/);

  const availability = read("src/lib/bot-api/booking-request-availability.ts");
  assert.match(availability, /INTERNAL eligibility only/);
  assert.doesNotMatch(availability, /assertOnlineBookable\(/);

  const hooks = read("src/lib/bot-api/booking-request-test-hooks.ts");
  assert.match(hooks, /SECURITY_BATCH_TEST/);
  assert.match(hooks, /NODE_ENV === "production"/);
  assert.match(hooks, /BOT_BOOKING_REQUEST_TEST_HOOK_DISABLED/);

  const appointment = read("src/services/AppointmentService.ts");
  assert.match(appointment, /createBotRequestAppointment/);
  assert.match(appointment, /servicePolicy:\s*"INTERNAL"/);

  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  assert.ok(pkg.scripts["test:security:bot-booking-request"]);
  assert.ok(pkg.scripts["test:security:bot-booking-request-db"]);
  assert.match(
    pkg.scripts["test:security:bot-booking-request-db:required"] ?? "",
    /--require-postgres/,
  );
  assert.doesNotMatch(
    pkg.scripts["test:security:bot-booking-request-db:required"] ?? "",
    /\|\| true/,
  );

  const workflow = read(BOT_BOOKING_CREATE_CI_WORKFLOW_PATH);
  assertBookingRequestStaticGateWired(workflow);
  assertBookingRequestRequiredPgGateWired(workflow);
  assert.match(
    workflow,
    /src\/app\/api\/internal\/bot\/v1\/booking-requests\/\*\*/,
  );
  assert.match(workflow, /src\/services\/BotBookingRequestService\.ts/);
  assert.match(workflow, /scripts\/security-bot-booking-request/);

  assert.throws(
    () =>
      assertBookingRequestStaticGateWired(`
name: x
jobs:
  j:
    steps:
      - name: ${BOOKING_REQUEST_STATIC_GATE_STEP_NAME}
        run: echo "${BOOKING_REQUEST_STATIC_NPM}"
`),
    /must execute/,
  );
  assert.throws(
    () =>
      assertBookingRequestRequiredPgGateWired(`
name: x
jobs:
  j:
    steps:
      - name: ${BOOKING_REQUEST_REQUIRED_GATE_STEP_NAME}
        run: echo "${BOOKING_REQUEST_REQUIRED_NPM}"
`),
    /must execute/,
  );
  assert.equal(
    runTextExecutesExactNpmCommand(
      `echo "${BOOKING_REQUEST_REQUIRED_NPM}"`,
      BOOKING_REQUEST_REQUIRED_NPM,
    ),
    false,
  );

  record("static-invariants", "PASSED");
}

async function testServerOnlyHarnessImports(): Promise<void> {
  installServerOnlyShimForSecurityScripts();
  const db = await import("../src/lib/db");
  assert.ok(db.prisma);
  const service = await import("../src/services/BotBookingRequestService");
  assert.equal(typeof service.bookBotBookingRequest, "function");
  assert.equal(typeof service.getBotBookingRequestAvailability, "function");
  record("server-only-harness-imports", "PASSED");
}

async function canQuery(databaseUrl: string): Promise<boolean> {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryUntilSettled<T>(
  fn: () => Promise<T>,
  isRetryable: (value: T) => boolean,
  attempts = 16,
  delayMs = 40,
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

async function runDbSuite(databaseUrl: string): Promise<void> {
  ensureTestHmacEnv();
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const { formatStudioOffsetDateTime } = await import(
    "../src/lib/datetime/date-layer"
  );
  const {
    bookBotBookingRequest,
    getBotBookingRequestAvailability,
    clearBotBookingRequestTestHooks,
    createCountdownBarrier,
    setBotBookingRequestTestHooks,
  } = await import("../src/services/BotBookingRequestService");

  const fixture = await createBotBookingRequestPgFixture(prisma);
  const trackedKeys: string[] = [];
  const startsAt = formatStudioOffsetDateTime(
    fixture.dateKey,
    fixture.startTime,
  );
  assert.ok(startsAt, "fixture startsAt must be valid studio offset datetime");

  try {
    // G. Request-only / online flags disabled — availability still works.
    {
      const master = await prisma.master.findUniqueOrThrow({
        where: { id: fixture.masterId },
        select: { isOnlineBookingEnabled: true },
      });
      const service = await prisma.service.findUniqueOrThrow({
        where: { id: fixture.serviceId },
        select: { isOnlineBookingEnabled: true },
      });
      assert.equal(master.isOnlineBookingEnabled, false);
      assert.equal(service.isOnlineBookingEnabled, false);

      const month = await getBotBookingRequestAvailability({
        requestId: fixture.requestId,
        month: fixture.dateKey.slice(0, 7),
      });
      assert.equal(month.ok, true);
      if (!month.ok) throw new Error("availability month failed");
      assert.ok(
        "dateKeys" in month.body &&
          month.body.dateKeys.includes(fixture.dateKey),
        "request-only month includes fixture work day",
      );

      const day = await getBotBookingRequestAvailability({
        requestId: fixture.requestId,
        date: fixture.dateKey,
      });
      assert.equal(day.ok, true);
      if (!day.ok) throw new Error("availability day failed");
      assert.ok("slots" in day.body);
      assert.ok(
        day.body.slots.some((s) => s.startsAt === startsAt),
        "request-only day slots include fixture startsAt",
      );
      record("g-request-only-online-flags", "PASSED");
    }

    // A. SUCCESS PATH
    {
      const key = randomUUID();
      trackedKeys.push(key);
      const result = await bookBotBookingRequest({
        requestId: fixture.requestId,
        startsAt,
        idempotencyKey: key,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(result.ok, true, "A: book must succeed");
      if (!result.ok) throw new Error("A failed");

      const request = await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: {
          status: true,
          appointmentId: true,
          masterId: true,
          serviceId: true,
        },
      });
      assert.equal(request.status, "CLOSED");
      assert.equal(request.appointmentId, result.body.appointmentId);

      const appointment = await prisma.appointment.findUniqueOrThrow({
        where: { id: result.body.appointmentId },
        select: {
          id: true,
          masterId: true,
          serviceId: true,
          source: true,
          status: true,
          startsAt: true,
        },
      });
      assert.equal(appointment.masterId, fixture.masterId);
      assert.equal(appointment.serviceId, fixture.serviceId);
      assert.equal(appointment.source, "BOT");
      assert.ok(
        appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED",
      );
      assert.equal(appointment.id, request.appointmentId);
      assert.equal(result.body.status, "CLOSED");
      assert.equal(result.body.idempotentReplay, false);
      record("a-success-path", "PASSED");
    }

    // B. IDEMPOTENT REPLAY
    {
      const key = trackedKeys[trackedKeys.length - 1]!;
      const beforeCount = await prisma.appointment.count({
        where: { masterId: fixture.masterId },
      });
      const replay = await bookBotBookingRequest({
        requestId: fixture.requestId,
        startsAt,
        idempotencyKey: key,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(replay.ok, true);
      if (!replay.ok) throw new Error("B failed");
      assert.equal(replay.body.idempotentReplay, true);
      assert.equal(replay.body.status, "CLOSED");

      const afterCount = await prisma.appointment.count({
        where: { masterId: fixture.masterId },
      });
      assert.equal(afterCount, beforeCount, "B: no second appointment");

      const request = await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: { appointmentId: true, status: true },
      });
      assert.equal(request.status, "CLOSED");
      assert.equal(request.appointmentId, replay.body.appointmentId);
      record("b-idempotent-replay", "PASSED");
    }

    // Reset for remaining scenarios: clear appointment link + appointments.
    await prisma.bookingRequest.update({
      where: { id: fixture.requestId },
      data: { status: "NEW", appointmentId: null },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;

    // C. CONCURRENT SAME REQUEST / DUPLICATE PREVENTION
    {
      const key1 = randomUUID();
      const key2 = randomUUID();
      trackedKeys.push(key1, key2);
      const barrier = createCountdownBarrier(2);
      setBotBookingRequestTestHooks({
        beforeSerializableWrite: () => barrier.wait(),
      });
      try {
        const results = await Promise.all([
          bookBotBookingRequest({
            requestId: fixture.requestId,
            startsAt,
            idempotencyKey: key1,
            dateKey: fixture.dateKey,
            startTime: fixture.startTime,
          }),
          bookBotBookingRequest({
            requestId: fixture.requestId,
            startsAt,
            idempotencyKey: key2,
            dateKey: fixture.dateKey,
            startTime: fixture.startTime,
          }),
        ]);
        const successes = results.filter((r) => r.ok);
        assert.ok(
          successes.length >= 1 && successes.length <= 2,
          "C: at least one success, at most two verified outcomes",
        );
        const apptCount = await prisma.appointment.count({
          where: { masterId: fixture.masterId },
        });
        assert.equal(apptCount, 1, "C: single appointment");

        const appointmentIds = new Set(
          successes.map((r) => (r.ok ? r.body.appointmentId : "")),
        );
        assert.equal(
          appointmentIds.size,
          1,
          "C: all successes share one appointmentId",
        );

        const losers = results.filter((r) => !r.ok);
        for (const loser of losers) {
          if (!loser.ok) {
            assert.ok(
              loser.code === "SLOT_NO_LONGER_AVAILABLE" ||
                loser.code === "BOOKING_CONFLICT" ||
                loser.code === "BOOKING_REQUEST_CONFLICT" ||
                loser.code === "IDEMPOTENCY_IN_PROGRESS" ||
                loser.code === "RECONCILIATION_REQUIRED",
              `C: typed loser code, got ${loser.code}`,
            );
          }
        }

        const settled = await retryUntilSettled(
          () =>
            prisma.bookingRequest.findUniqueOrThrow({
              where: { id: fixture.requestId },
              select: { status: true, appointmentId: true },
            }),
          (row) => row.status !== "CLOSED" || !row.appointmentId,
        );
        assert.equal(settled.status, "CLOSED");
        assert.ok(settled.appointmentId);
        assert.equal(
          settled.appointmentId,
          [...appointmentIds][0],
        );
      } finally {
        clearBotBookingRequestTestHooks();
        barrier.cancel();
      }
      record("c-concurrent-duplicate-prevention", "PASSED");
    }

    // D. SLOT RACE / OCCUPIED INTERVAL
    await prisma.bookingRequest.update({
      where: { id: fixture.requestId },
      data: { status: "NEW", appointmentId: null },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;

    {
      const { parseStudioDateTime, addMinutesSafe } =
        await import("../src/lib/datetime/date-layer");
      const starts = parseStudioDateTime(fixture.dateKey, fixture.startTime);
      const ends =
        addMinutesSafe(starts, fixture.durationMinutes) ?? starts;
      await prisma.appointment.create({
        data: {
          masterId: fixture.masterId,
          serviceId: fixture.serviceId,
          clientName: `${fixture.nameTag} occupied`,
          clientPhone: nextFixturePhone(fixture.runId, 91),
          startsAt: starts,
          endsAt: ends,
          status: "SCHEDULED",
          source: "INTERNAL",
        },
      });

      const key = randomUUID();
      trackedKeys.push(key);
      const result = await bookBotBookingRequest({
        requestId: fixture.requestId,
        startsAt,
        idempotencyKey: key,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(result.ok, false, "D: occupied slot must fail");
      if (result.ok) throw new Error("D unexpectedly succeeded");
      assert.ok(
        result.code === "SLOT_NO_LONGER_AVAILABLE" ||
          result.code === "BOOKING_CONFLICT",
        `D: typed conflict code, got ${result.code}`,
      );

      const request = await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: { status: true, appointmentId: true },
      });
      assert.notEqual(request.status, "CLOSED");
      assert.equal(request.appointmentId, null);

      const botCount = await prisma.appointment.count({
        where: { masterId: fixture.masterId, source: "BOT" },
      });
      assert.equal(botCount, 0, "D: no BOT appointment created");
      record("d-slot-occupied", "PASSED");
    }

    // E. POSTCHECK / RECONCILIATION — mismatched linked appointment
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;

    {
      const { parseStudioDateTime, addMinutesSafe } = await import(
        "../src/lib/datetime/date-layer"
      );
      const wrongStarts = parseStudioDateTime(fixture.dateKey, "16:00");
      const wrongEnds =
        addMinutesSafe(wrongStarts, fixture.durationMinutes) ?? wrongStarts;
      const mismatched = await prisma.appointment.create({
        data: {
          masterId: fixture.masterId,
          serviceId: fixture.serviceId,
          clientName: `${fixture.nameTag} mismatch`,
          clientPhone: nextFixturePhone(fixture.runId, 92),
          startsAt: wrongStarts,
          endsAt: wrongEnds,
          status: "SCHEDULED",
          source: "INTERNAL",
        },
      });
      await prisma.bookingRequest.update({
        where: { id: fixture.requestId },
        data: {
          status: "CONTACTED",
          appointmentId: mismatched.id,
        },
      });

      const key = randomUUID();
      trackedKeys.push(key);
      const result = await bookBotBookingRequest({
        requestId: fixture.requestId,
        startsAt,
        idempotencyKey: key,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("E unexpectedly succeeded");
      assert.equal(result.code, "RECONCILIATION_REQUIRED");

      const request = await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: { status: true, appointmentId: true },
      });
      assert.notEqual(request.status, "CLOSED");
      assert.equal(request.appointmentId, mismatched.id);

      const botCount = await prisma.appointment.count({
        where: { masterId: fixture.masterId, source: "BOT" },
      });
      assert.equal(botCount, 0, "E: no extra BOT appointment on reconciliation");

      // Retry with new key must remain fail-closed (no second create).
      const key2 = randomUUID();
      trackedKeys.push(key2);
      const retry = await bookBotBookingRequest({
        requestId: fixture.requestId,
        startsAt,
        idempotencyKey: key2,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(retry.ok, false);
      if (!retry.ok) {
        assert.equal(retry.code, "RECONCILIATION_REQUIRED");
      }
      assert.equal(
        await prisma.appointment.count({
          where: { masterId: fixture.masterId, source: "BOT" },
        }),
        0,
      );
      record("e-postcheck-reconciliation", "PASSED");
    }

    // F. CONSULTATION WITHOUT SERVICE
    await prisma.bookingRequest.update({
      where: { id: fixture.requestId },
      data: { status: "NEW", appointmentId: null },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    trackedKeys.length = 0;

    {
      const consultId = randomUUID();
      await prisma.bookingRequest.create({
        data: {
          id: consultId,
          clientName: `${fixture.nameTag} consult`,
          clientPhone: nextFixturePhone(fixture.runId, 93),
          masterId: fixture.masterId,
          serviceId: null,
          status: "NEW",
          source: "ONLINE",
          type: "CONSULTATION_REQUEST",
        },
      });
      const key = randomUUID();
      trackedKeys.push(key);
      const result = await bookBotBookingRequest({
        requestId: consultId,
        startsAt,
        idempotencyKey: key,
        dateKey: fixture.dateKey,
        startTime: fixture.startTime,
      });
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("F unexpectedly succeeded");
      assert.equal(result.code, "CONSULTATION_SERVICE_REQUIRED");

      const request = await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: consultId },
        select: { status: true, appointmentId: true },
      });
      assert.equal(request.status, "NEW");
      assert.equal(request.appointmentId, null);
      assert.equal(
        await prisma.appointment.count({
          where: { masterId: fixture.masterId, source: "BOT" },
        }),
        0,
      );
      await prisma.bookingRequest.delete({ where: { id: consultId } });
      record("f-consultation-without-service", "PASSED");
    }
  } finally {
    clearBotBookingRequestTestHooks();
    await prisma.internalBotBookingOperation.deleteMany({
      where: { idempotencyKey: { in: trackedKeys } },
    });
    await prisma.bookingRequest.deleteMany({
      where: { masterId: fixture.masterId },
    });
    await prisma.appointment.deleteMany({
      where: { masterId: fixture.masterId },
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
    console.error(`FAILED: test-database-guard (${eligibility.detail})`);
    console.error(
      "security-bot-booking-request-db-check: REQUIRED MODE FAILED",
    );
    process.exit(1);
  }

  if (eligibility.kind === "skip") {
    record("postgres-races", "SKIPPED", eligibility.detail);
    console.log(`SKIPPED — NON-GATING MODE (${eligibility.detail})`);
    console.log(
      "Concurrency NOT proven — PostgreSQL race suite was not executed.",
    );
    for (const row of outcomes) {
      console.log(
        `${row.outcome}: ${row.name}${row.detail ? ` (${row.detail})` : ""}`,
      );
    }
    console.log(
      "security-bot-booking-request-db-check: STATIC OK; RACES NOT RUN",
    );
    return;
  }

  try {
    await runDbSuite(eligibility.databaseUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record("postgres-races", "FAILED", detail);
    console.error(`FAILED: postgres-races (${detail})`);
    if (REQUIRE_POSTGRES) {
      console.error(
        "security-bot-booking-request-db-check: REQUIRED MODE FAILED",
      );
    } else {
      console.error("security-bot-booking-request-db-check: FAILED");
    }
    process.exit(1);
  }

  for (const row of outcomes) {
    console.log(
      `${row.outcome}: ${row.name}${row.detail ? ` (${row.detail})` : ""}`,
    );
  }
  if (REQUIRE_POSTGRES) {
    console.log("security-bot-booking-request-db-check: REQUIRED MODE OK");
  } else {
    console.log(
      "security-bot-booking-request-db-check: OK (races executed)",
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
