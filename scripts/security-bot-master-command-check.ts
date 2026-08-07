/**
 * CURSOR-26 — Master Command API security / contract checks (no DB required).
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isCanonicalUuid } from "../src/lib/booking-requests/idempotency-contract";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { getRateLimitPolicy } from "../src/lib/security/rate-limit/policies";
import { requiresAdminCsrfProtection } from "../src/lib/security/csrf-route-rules";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

installServerOnlyShimForSecurityScripts();

const ROOT = process.cwd();
const MASTER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const KEY = "550e8400-e29b-41d4-a716-446655440000";
const BLOCK = "660e8400-e29b-41d4-a716-446655440000";
const HMAC = "cursor26-bot-idempotency-hmac-secret-32b!!";

assert.ok(isCanonicalUuid(MASTER));
assert.ok(isCanonicalUuid(KEY));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MASTER_ROUTES = [
  "src/app/api/internal/bot/v1/master/schedule/route.ts",
  "src/app/api/internal/bot/v1/master/blocks/close-interval/route.ts",
  "src/app/api/internal/bot/v1/master/blocks/close-day/route.ts",
  "src/app/api/internal/bot/v1/master/blocks/delete/route.ts",
  "src/app/api/internal/bot/v1/master/extra-work/create/route.ts",
  "src/app/api/internal/bot/v1/master/extra-work/delete/route.ts",
  "src/app/api/internal/bot/v1/master/bookings/route.ts",
];

async function testParsers(): Promise<void> {
  const {
    parseMasterScheduleReadBody,
    parseMasterCloseIntervalBody,
    parseMasterCloseDayBody,
    parseMasterDeleteBlockBody,
    parseMasterExtraWorkCreateBody,
    parseMasterExtraWorkDeleteBody,
    parseMasterBookingCreateBody,
    MASTER_SCHEDULE_MAX_RANGE_DAYS,
  } = await import("../src/lib/bot-api/master-command-types");

  assert.equal(MASTER_SCHEDULE_MAX_RANGE_DAYS, 14);

  const okSchedule = parseMasterScheduleReadBody({
    masterId: MASTER,
    fromDateKey: "2026-08-01",
    toDateKey: "2026-08-07",
  });
  assert.equal(okSchedule.ok, true);

  const tooLarge = parseMasterScheduleReadBody({
    masterId: MASTER,
    fromDateKey: "2026-08-01",
    toDateKey: "2026-08-20",
  });
  assert.equal(tooLarge.ok, false);

  const interval = parseMasterCloseIntervalBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "12:00",
    endTime: "13:00",
    blockType: "PERSONAL",
  });
  assert.equal(interval.ok, true);

  const badType = parseMasterCloseIntervalBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "12:00",
    endTime: "13:00",
    blockType: "TECHNICAL",
  });
  assert.equal(badType.ok, false);

  const day = parseMasterCloseDayBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    dateKey: "2026-08-10",
    blockType: "DAY_OFF",
  });
  assert.equal(day.ok, true);

  const del = parseMasterDeleteBlockBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    blockId: BLOCK,
  });
  assert.equal(del.ok, true);

  const ew = parseMasterExtraWorkCreateBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "18:00",
    endTime: "20:00",
    isOnlineBookingEnabled: false,
  });
  assert.equal(ew.ok, true);

  const ewd = parseMasterExtraWorkDeleteBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    extraWorkWindowId: BLOCK,
  });
  assert.equal(ewd.ok, true);

  const slotId = `bs1.${SERVICE}.${MASTER}.2026-08-10.1000`;
  const booking = parseMasterBookingCreateBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    slotId,
    clientName: "Иван",
    phone: "+79001234567",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(booking.ok, true);

  const scopeMismatch = parseMasterBookingCreateBody({
    idempotencyKey: KEY,
    masterId: OTHER,
    slotId,
    clientName: "Иван",
    phone: "+79001234567",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(scopeMismatch.ok, false);

  const unknownField = parseMasterCloseIntervalBody({
    idempotencyKey: KEY,
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "12:00",
    endTime: "13:00",
    blockType: "PERSONAL",
    comment: "nope",
  });
  assert.equal(unknownField.ok, false);
}

async function testFingerprintsAndSnapshots(): Promise<void> {
  process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET = HMAC;
  delete process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;

  const {
    computeMasterCloseIntervalFingerprint,
    computeMasterBookingCreateFingerprint,
    sanitizeMasterBlockSnapshot,
    sanitizeMasterBookingSnapshot,
  } = await import("../src/lib/bot-api/master-command-idempotency");

  const a = computeMasterCloseIntervalFingerprint({
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "12:00",
    endTime: "13:00",
    blockType: "PERSONAL",
  });
  const b = computeMasterCloseIntervalFingerprint({
    masterId: MASTER,
    dateKey: "2026-08-10",
    startTime: "12:00",
    endTime: "14:00",
    blockType: "PERSONAL",
  });
  assert.notEqual(a.current, b.current);

  const bookingFp = computeMasterBookingCreateFingerprint({
    masterId: MASTER,
    slotId: `bs1.${SERVICE}.${MASTER}.2026-08-10.1000`,
    clientName: "Иван",
    phone: "+79001234567",
    personalDataConsent: true,
    offerAcknowledgement: true,
  });
  assert.equal(bookingFp.current.length, 64);

  assert.equal(
    sanitizeMasterBlockSnapshot({
      blockId: BLOCK,
      masterId: MASTER,
      dateKey: "2026-08-10",
      isFullDay: false,
      blockType: "PERSONAL",
      startsAt: "2026-08-10T07:00:00.000Z",
      endsAt: "2026-08-10T08:00:00.000Z",
      phone: "+7900",
    }),
    null,
  );

  assert.equal(
    sanitizeMasterBookingSnapshot({
      bookingId: BLOCK,
      slotId: "bs1.x",
      masterId: MASTER,
      status: "SCHEDULED",
      startsAt: "2026-08-10T05:00:00+05:00",
      clientPhone: "+7900",
    }),
    null,
  );

  assert.ok(
    sanitizeMasterBookingSnapshot({
      bookingId: BLOCK,
      slotId: "bs1.x",
      masterId: MASTER,
      status: "SCHEDULED",
      startsAt: "2026-08-10T05:00:00+05:00",
    }),
  );
}

function testStaticArchitecture(): void {
  const scheduleRel = "src/app/api/internal/bot/v1/master/schedule/route.ts";
  const mutationRels = MASTER_ROUTES.filter((rel) => rel !== scheduleRel);

  for (const rel of MASTER_ROUTES) {
    const src = stripComments(read(rel));
    assert.match(src, /withBotInternalApi/, `${rel} must use wrapper`);
    assert.match(
      src,
      /from "@\/lib\/auth\/bot-internal-api"/,
      `${rel} approved import`,
    );
    assert.match(src, /readBoundedJsonBody/, `${rel} bounded body`);
    assert.match(src, /isExactApplicationJsonContentType/, `${rel} content-type`);
    assert.doesNotMatch(src, /clientPhone|manageToken/, `${rel} no PII fields`);
  }

  const scheduleRoute = stripComments(read(scheduleRel));
  assert.match(
    scheduleRoute,
    /rateLimitPolicy:\s*"botInternal"/,
    "schedule-read must explicitly use botInternal",
  );
  assert.doesNotMatch(
    scheduleRoute,
    /rateLimitPolicy:\s*"botInternalMasterCommand"/,
    "schedule must not use mutation bucket",
  );

  for (const rel of mutationRels) {
    const src = stripComments(read(rel));
    assert.match(
      src,
      /rateLimitPolicy:\s*"botInternalMasterCommand"/,
      `${rel} must use botInternalMasterCommand`,
    );
  }

  const service = stripComments(read("src/services/MasterCommandService.ts"));
  assert.match(service, /origin:\s*"BOT_MASTER_COMMAND"/);
  assert.match(service, /deleteOwnedMasterScheduleBlock/);
  assert.match(service, /deleteOwnedMasterExtraWorkWindow/);
  assert.match(service, /createBotOnlineAppointment/);
  assert.match(service, /runSerializableAppointmentWrite/);
  assert.match(service, /mapScheduleDayAppointmentMaster/);
  assert.match(service, /export function mapMasterCommandDomainFailure/);
  assert.doesNotMatch(service, /mapScheduleDayAppointmentOperational/);
  assert.doesNotMatch(
    service,
    /error\.message\.includes\(/,
    "domain mapping must not use message substrings",
  );
  assert.doesNotMatch(service, /BOOKING_CONFLICT/);

  const blockSvc = stripComments(read("src/services/ScheduleBlockService.ts"));
  assert.match(blockSvc, /deleteOwnedMasterScheduleBlock/);
  assert.match(blockSvc, /ScheduleBlockOwnershipCode/);
  assert.match(blockSvc, /CROSS_MASTER/);
  assert.match(blockSvc, /WRONG_ORIGIN/);

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /enum ScheduleResourceOrigin/);
  assert.match(schema, /BOT_MASTER_COMMAND/);

  const migration = read(
    "prisma/migrations/20260807120000_master_command_api/migration.sql",
  );
  assert.match(migration, /ScheduleResourceOrigin/);
  assert.match(migration, /schedule_blocks/);
  assert.match(migration, /extra_work_windows/);

  const adr = read("docs/architecture/bot-master-command-api.md");
  assert.match(adr, /CURSOR-26/);
  assert.match(adr, /BOT_MASTER_COMMAND/);
  assert.match(adr, /idempotency/i);

  const ecosystem = read("docs/ecosystem/04-internal-bot-api.md");
  assert.match(ecosystem, /Master Command API[\s\S]*IMPLEMENTED/);
  assert.doesNotMatch(
    ecosystem,
    /Master Command API \| `DONE`/,
    "ecosystem must not claim DONE before migration+PG gate",
  );
}

async function testTypedDomainMapping(): Promise<void> {
  const {
    mapMasterCommandDomainFailure,
  } = await import("../src/services/MasterCommandService");
  const {
    ScheduleBlockConflictError,
    ScheduleBlockOwnershipError,
    ScheduleBlockValidationError,
  } = await import("../src/services/ScheduleBlockService");
  const {
    ExtraWorkOwnershipError,
    ExtraWorkValidationError,
    ExtraWorkInUseError,
  } = await import("../src/services/ExtraWorkWindowService");
  const { AppointmentValidationError } = await import(
    "../src/services/AppointmentService"
  );

  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockConflictError("APPOINTMENT_OVERLAP", "x"),
    ).code,
    "APPOINTMENT_CONFLICT",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockConflictError("DAY_HAS_APPOINTMENTS", "x"),
    ).code,
    "APPOINTMENT_CONFLICT",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockConflictError("FULL_DAY_EXISTS", "x"),
    ).code,
    "BLOCK_CONFLICT",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockOwnershipError("CROSS_MASTER", "x"),
    ).code,
    "BLOCK_NOT_OWNED",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockOwnershipError("WRONG_ORIGIN", "x"),
    ).code,
    "BLOCK_NOT_OWNED",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockValidationError("NOT_FOUND", "x"),
    ).code,
    "BLOCK_NOT_FOUND",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ScheduleBlockValidationError("INVALID_TYPE", "x"),
    ).code,
    "VALIDATION_ERROR",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ExtraWorkOwnershipError("CROSS_MASTER", "x"),
    ).code,
    "EXTRA_WORK_NOT_OWNED",
  );
  assert.equal(
    mapMasterCommandDomainFailure(
      new ExtraWorkValidationError("NOT_FOUND", "x"),
    ).code,
    "EXTRA_WORK_NOT_FOUND",
  );
  assert.equal(
    mapMasterCommandDomainFailure(new ExtraWorkInUseError("x")).code,
    "EXTRA_WORK_IN_USE",
  );
  assert.equal(
    mapMasterCommandDomainFailure(new AppointmentValidationError("bad timing"))
      .code,
    "VALIDATION_ERROR",
  );
}

async function testOwnedDeleteBehavioralHarness(): Promise<void> {
  const {
    deleteOwnedMasterScheduleBlock,
    ScheduleBlockOwnershipError,
    ScheduleBlockValidationError,
  } = await import("../src/services/ScheduleBlockService");
  const {
    deleteOwnedMasterExtraWorkWindow,
    ExtraWorkOwnershipError,
  } = await import("../src/services/ExtraWorkWindowService");
  const {
    mapMasterCommandDomainFailure,
  } = await import("../src/services/MasterCommandService");

  const masterA = MASTER;
  const masterB = OTHER;
  const ownedId = BLOCK;
  const foreignId = "770e8400-e29b-41d4-a716-446655440000";
  const adminId = "880e8400-e29b-41d4-a716-446655440000";

  const blocks = new Map([
    [
      ownedId,
      {
        id: ownedId,
        masterId: masterA,
        origin: "BOT_MASTER_COMMAND" as const,
      },
    ],
    [
      foreignId,
      {
        id: foreignId,
        masterId: masterB,
        origin: "BOT_MASTER_COMMAND" as const,
      },
    ],
    [
      adminId,
      {
        id: adminId,
        masterId: masterA,
        origin: "ADMIN_UI" as const,
      },
    ],
  ]);

  const fakeBlockDb = {
    scheduleBlock: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        blocks.get(id) ?? null,
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        const row = blocks.get(id);
        if (!row) throw new Error("missing");
        blocks.delete(id);
        return row;
      },
    },
    appointment: {
      findMany: async () => [],
      count: async () => 0,
    },
  };

  await deleteOwnedMasterScheduleBlock(fakeBlockDb as never, {
    blockId: ownedId,
    masterId: masterA,
  });
  assert.equal(blocks.has(ownedId), false, "owned BOT_MASTER_COMMAND deleted");

  await assert.rejects(
    () =>
      deleteOwnedMasterScheduleBlock(fakeBlockDb as never, {
        blockId: foreignId,
        masterId: masterA,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ScheduleBlockOwnershipError);
      assert.equal(error.code, "CROSS_MASTER");
      assert.equal(
        mapMasterCommandDomainFailure(error).code,
        "BLOCK_NOT_OWNED",
      );
      return true;
    },
  );
  assert.equal(blocks.has(foreignId), true, "cross-master block remains");

  await assert.rejects(
    () =>
      deleteOwnedMasterScheduleBlock(fakeBlockDb as never, {
        blockId: adminId,
        masterId: masterA,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ScheduleBlockOwnershipError);
      assert.equal(error.code, "WRONG_ORIGIN");
      assert.equal(
        mapMasterCommandDomainFailure(error).code,
        "BLOCK_NOT_OWNED",
      );
      return true;
    },
  );
  assert.equal(blocks.has(adminId), true, "ADMIN_UI block remains");

  await assert.rejects(
    () =>
      deleteOwnedMasterScheduleBlock(fakeBlockDb as never, {
        blockId: "990e8400-e29b-41d4-a716-446655440000",
        masterId: masterA,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ScheduleBlockValidationError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(
        mapMasterCommandDomainFailure(error).code,
        "BLOCK_NOT_FOUND",
      );
      return true;
    },
  );

  const windows = new Map([
    [
      ownedId,
      {
        id: ownedId,
        masterId: masterA,
        origin: "BOT_MASTER_COMMAND" as const,
        startsAt: new Date("2026-08-10T13:00:00.000Z"),
        endsAt: new Date("2026-08-10T15:00:00.000Z"),
        workDate: new Date("2026-08-10T00:00:00.000Z"),
      },
    ],
    [
      foreignId,
      {
        id: foreignId,
        masterId: masterB,
        origin: "BOT_MASTER_COMMAND" as const,
        startsAt: new Date("2026-08-10T13:00:00.000Z"),
        endsAt: new Date("2026-08-10T15:00:00.000Z"),
        workDate: new Date("2026-08-10T00:00:00.000Z"),
      },
    ],
  ]);

  const fakeExtraDb = {
    extraWorkWindow: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        windows.get(id) ?? null,
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        const row = windows.get(id);
        if (!row) throw new Error("missing");
        windows.delete(id);
        return row;
      },
    },
    appointment: {
      findMany: async () => [],
    },
  };

  await deleteOwnedMasterExtraWorkWindow(fakeExtraDb as never, {
    extraWorkWindowId: ownedId,
    masterId: masterA,
  });
  assert.equal(windows.has(ownedId), false);

  await assert.rejects(
    () =>
      deleteOwnedMasterExtraWorkWindow(fakeExtraDb as never, {
        extraWorkWindowId: foreignId,
        masterId: masterA,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExtraWorkOwnershipError);
      assert.equal(error.code, "CROSS_MASTER");
      assert.equal(
        mapMasterCommandDomainFailure(error).code,
        "EXTRA_WORK_NOT_OWNED",
      );
      return true;
    },
  );
  assert.equal(windows.has(foreignId), true);
}

async function testHooksFailClosed(): Promise<void> {
  const {
    masterCommandTestHooksAllowed,
    setMasterCommandTestHooks,
  } = await import("../src/lib/bot-api/master-command-test-hooks");

  assert.equal(
    masterCommandTestHooksAllowed({
      NODE_ENV: "production",
      SECURITY_BATCH_TEST: "1",
    }),
    false,
  );
  assert.equal(
    masterCommandTestHooksAllowed({
      NODE_ENV: "test",
      SECURITY_BATCH_TEST: "1",
    }),
    true,
  );
  assert.throws(
    () =>
      setMasterCommandTestHooks(
        { beforeSerializableWrite: () => undefined },
        { NODE_ENV: "production", SECURITY_BATCH_TEST: "1" },
      ),
    /MASTER_COMMAND_TEST_HOOK_DISABLED/,
  );
}

function testRateLimitsAndCsrf(): void {
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/master/schedule", "POST"),
    "botInternal",
  );
  assert.equal(
    resolveApiRateLimitPolicy(
      "/api/internal/bot/v1/master/blocks/close-interval",
      "POST",
    ),
    "botInternalMasterCommand",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/master/bookings", "POST"),
    "botInternalMasterCommand",
  );

  const policy = getRateLimitPolicy("botInternalMasterCommand");
  assert.equal(policy.maxRequests, 60);

  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v1/master/schedule"),
    false,
  );
  assert.equal(
    requiresAdminCsrfProtection(
      "/api/internal/bot/v1/master/blocks/close-interval",
    ),
    false,
  );
}

function testSharedIdempotencyReuse(): void {
  const bookingIdem = stripComments(
    read("src/lib/bot-api/booking-create-idempotency.ts"),
  );
  assert.match(
    bookingIdem,
    /claimInternalBotOperationIdempotency/,
    "booking create reuses shared idempotency claim",
  );

  const shared = stripComments(
    read("src/lib/bot-api/internal-bot-operation-idempotency.ts"),
  );
  assert.match(shared, /operationKind/);
  assert.match(shared, /requestFingerprint/);
}

async function main(): Promise<void> {
  await testParsers();
  await testFingerprintsAndSnapshots();
  testStaticArchitecture();
  testRateLimitsAndCsrf();
  testSharedIdempotencyReuse();
  await testTypedDomainMapping();
  await testOwnedDeleteBehavioralHarness();
  await testHooksFailClosed();
  console.log("security-bot-master-command-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
