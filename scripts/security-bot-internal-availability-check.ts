/**
 * CURSOR-21 — bot internal availability (available-days / slots).
 * Mutation-sensitive auth, validation, DTO, policy, and coverage checks (no DB).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { isCanonicalUuid } from "../src/lib/booking-requests/idempotency-contract";
import { resolveApiRateLimitPolicy } from "../src/lib/security/rate-limit/route-rules";
import { requiresAdminCsrfProtection } from "../src/lib/security/csrf-route-rules";

process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";
const originalConsoleError = console.error;
console.error = () => {};

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "11111111-1111-4111-8111-222222222222";
const S1 = "22222222-2222-4222-8222-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const TOKEN = "cursor21-bot-avail-token-32chars-min!!";

assert.ok(TOKEN.length >= 32);
assert.ok(isCanonicalUuid(M1));
assert.ok(isCanonicalUuid(S1));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function withTokenEnv<T>(token: string | undefined, run: () => T): T {
  const previous = process.env.BOT_INTERNAL_API_TOKEN;
  if (token === undefined) {
    delete process.env.BOT_INTERNAL_API_TOKEN;
  } else {
    process.env.BOT_INTERNAL_API_TOKEN = token;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.BOT_INTERNAL_API_TOKEN;
    } else {
      process.env.BOT_INTERNAL_API_TOKEN = previous;
    }
  }
}

async function loadAvailability() {
  return import("../src/lib/bot-api/availability");
}

async function loadAuth() {
  return import("../src/lib/auth/bot-internal-auth");
}

async function loadMorningCutoff() {
  return import("../src/lib/booking/public-morning-slot-cutoff");
}

async function loadBooking() {
  return import("../src/services/BookingService");
}

function testStaticRouteWiring(): void {
  const daysRoute = read(
    "src/app/api/internal/bot/v1/available-days/route.ts",
  );
  const slotsRoute = read("src/app/api/internal/bot/v1/slots/route.ts");
  const daysStripped = stripComments(daysRoute);
  const slotsStripped = stripComments(slotsRoute);

  for (const [label, source] of [
    ["available-days", daysRoute],
    ["slots", slotsRoute],
  ] as const) {
    assert.match(
      source,
      /import \{ withBotInternalApi \} from "@\/lib\/auth\/bot-internal-api"/,
      `${label} exact wrapper import`,
    );
    assert.match(source, /export const POST = withBotInternalApi/);
    assert.match(source, /readBoundedJsonBody/);
    assert.match(source, /BOT_INTERNAL_MAX_JSON_BODY_BYTES/);
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.match(source, /export const revalidate = 0/);
    assert.match(source, /getStudioNow\(\)/);
    assert.match(source, /formatStudioDateKey\(now\)/);
    assert.doesNotMatch(source, /searchParams|cookies\(/);
    assert.doesNotMatch(source, /createOnlineBooking|prisma\.(create|update|delete)/);
    assert.doesNotMatch(source, /console\.(log|info|debug|error)/);
    assert.doesNotMatch(source, /enforceSameOriginForMutatingRequest/);
    assert.doesNotMatch(source, /requireProtectedMutatingApi/);
    assert.ok(
      source.indexOf("withBotInternalApi") < source.indexOf("readBoundedJsonBody"),
      `${label}: auth wrapper text before body read (handler order)`,
    );
  }

  assert.match(daysStripped, /evaluateBotAvailableDays/);
  assert.match(slotsStripped, /evaluateBotAvailableSlots/);
  assert.match(daysStripped, /parseBotAvailableDaysBody/);
  assert.match(slotsStripped, /parseBotSlotsBody/);
  assert.doesNotMatch(daysRoute, /getAvailableTimeSlots/);
  assert.doesNotMatch(slotsRoute, /getAvailableDaysInMonth/);
  assert.doesNotMatch(daysRoute, /\/api\/booking\//);
  assert.doesNotMatch(slotsRoute, /\/api\/booking\//);
  assert.doesNotMatch(
    daysRoute,
    /from ["']\.\/|from ["']\.\.\//,
  );
  assert.doesNotMatch(
    slotsRoute,
    /from ["']\.\/|from ["']\.\.\//,
  );

  const moduleSource = read("src/lib/bot-api/availability.ts");
  assert.match(moduleSource, /import "server-only"/);
  assert.match(moduleSource, /getAvailableDaysInMonth/);
  assert.match(moduleSource, /getAvailableTimeSlots/);
  assert.match(moduleSource, /formatStudioOffsetDateTime/);
  assert.match(moduleSource, /OnlineServiceUnavailableError/);
  assert.match(moduleSource, /AppointmentValidationError/);
  assert.match(moduleSource, /BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS = 400/);
  assert.match(moduleSource, /SERVICE_UNAVAILABLE_CODE/);
  assert.match(moduleSource, /safeLogError/);
  assert.doesNotMatch(moduleSource, /createOnlineBooking/);
  assert.doesNotMatch(moduleSource, /prisma\.(create|update|delete|upsert)/);
  assert.doesNotMatch(moduleSource, /fetch\(/);

  const dateLayer = read("src/lib/datetime/date-layer.ts");
  assert.match(dateLayer, /export function formatStudioOffsetDateTime/);
  assert.match(dateLayer, /STUDIO_OFFSET/);

  const publicDays = read("src/app/api/booking/available-days/route.ts");
  const publicSlots = read("src/app/api/booking/slots/route.ts");
  assert.match(publicDays, /getAvailableDaysInMonth/);
  assert.match(publicSlots, /getAvailableTimeSlots/);
  assert.match(publicDays, /withPublicAvailabilityErrors/);
  assert.match(publicSlots, /withPublicAvailabilityErrors/);

  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v1/available-days", "POST"),
    false,
  );
  assert.equal(
    requiresAdminCsrfProtection("/api/internal/bot/v1/slots", "POST"),
    false,
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/available-days", "POST"),
    "botInternal",
  );
  assert.equal(
    resolveApiRateLimitPolicy("/api/internal/bot/v1/slots", "POST"),
    "botInternal",
  );

  const inventory = read("src/lib/security/rate-limit/route-rules.ts");
  assert.match(inventory, /\/api\/internal\/bot\/v1\/available-days/);
  assert.match(inventory, /\/api\/internal\/bot\/v1\/slots/);
}

async function testRouteCoverageIncludesNewRoutes(): Promise<void> {
  const coverage = await import("./security-bot-internal-route-coverage-check");
  const routes = coverage.assertBotInternalRouteCoverage();
  const normalized = routes.map((route) => route.replace(/\\/g, "/"));
  assert.ok(
    normalized.some((route) => route.endsWith("available-days/route.ts")),
  );
  assert.ok(normalized.some((route) => route.endsWith("slots/route.ts")));
  assert.ok(normalized.some((route) => route.endsWith("eligibility/route.ts")));
}

async function testAuthBeforeBodyAndTransport(): Promise<void> {
  const auth = await loadAuth();

  await withTokenEnv(undefined, async () => {
    const response = auth.enforceBotInternalAuth(
      new Request("http://localhost/api/internal/bot/v1/available-days", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999",
        },
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 401);
    const json = await readJson(response!);
    assert.equal(json.ok, false);
    assert.equal(json.code, "UNAUTHORIZED");
  });

  // Query / cookie must not satisfy auth.
  await withTokenEnv(TOKEN, async () => {
    const queryAttempt = auth.enforceBotInternalAuth(
      new Request(
        `http://localhost/api/internal/bot/v1/slots?token=${encodeURIComponent(TOKEN)}`,
        { method: "POST", headers: { cookie: `token=${TOKEN}` } },
      ),
    );
    assert.ok(queryAttempt);
    assert.equal(queryAttempt!.status, 401);
  });

  // Oversized body rejected before domain via bounded reader.
  const { readBoundedJsonBody, BOT_INTERNAL_MAX_JSON_BODY_BYTES } = await import(
    "../src/lib/bot-api/bounded-json-body"
  );
  const oversized = new Uint8Array(BOT_INTERNAL_MAX_JSON_BODY_BYTES + 1);
  oversized.fill(0x61);
  const tooBig = await readBoundedJsonBody(
    new Request("http://localhost/api/internal/bot/v1/slots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
          controller.close();
        },
      }),
      // @ts-expect-error undici duplex for streaming body
      duplex: "half",
    }),
  );
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) {
    assert.equal(tooBig.code, "PAYLOAD_TOO_LARGE");
  }
}

async function testValidationParsers(): Promise<void> {
  const {
    parseBotAvailableDaysBody,
    parseBotSlotsBody,
    isCanonicalLowercaseUuid,
  } = await loadAvailability();

  assert.equal(isCanonicalLowercaseUuid(M1), true);
  assert.equal(
    isCanonicalLowercaseUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
    true,
  );
  assert.equal(
    isCanonicalLowercaseUuid("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"),
    false,
  );
  assert.equal(isCanonicalLowercaseUuid(` ${M1}`), false);
  assert.equal(isCanonicalLowercaseUuid(`${M1} `), false);
  assert.equal(isCanonicalLowercaseUuid("not-a-uuid"), false);

  const baseDays = { serviceId: S1, masterId: M1, month: "2026-08" };
  const baseSlots = { serviceId: S1, masterId: M1, date: "2026-08-10" };

  assert.equal(parseBotAvailableDaysBody(baseDays).ok, true);
  assert.equal(parseBotSlotsBody(baseSlots).ok, true);

  for (const bad of [null, undefined, [], "x", 1, true]) {
    assert.equal(parseBotAvailableDaysBody(bad).ok, false);
    assert.equal(parseBotSlotsBody(bad).ok, false);
  }

  assert.equal(parseBotAvailableDaysBody({ ...baseDays, now: "x" }).ok, false);
  assert.equal(
    parseBotAvailableDaysBody({ ...baseDays, studioToday: "2026-08-01" }).ok,
    false,
  );
  assert.equal(parseBotSlotsBody({ ...baseSlots, slotId: "x" }).ok, false);
  assert.equal(parseBotSlotsBody({ ...baseSlots, now: "x" }).ok, false);
  assert.equal(parseBotSlotsBody({ ...baseSlots, extra: 1 }).ok, false);

  assert.equal(
    parseBotAvailableDaysBody({ masterId: M1, month: "2026-08" }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({ serviceId: S1, month: "2026-08" }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({ serviceId: S1, masterId: M1 }).ok,
    false,
  );

  assert.equal(
    parseBotAvailableDaysBody({
      ...baseDays,
      serviceId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({
      ...baseDays,
      masterId: ` ${M1}`,
    }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({
      ...baseDays,
      serviceId: "11111111-1111-4111-8111-11111111111g",
    }).ok,
    false,
  );

  assert.equal(
    parseBotAvailableDaysBody({ ...baseDays, month: "2026-8" }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({ ...baseDays, month: " 2026-08" }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({ ...baseDays, month: "2026-13" }).ok,
    false,
  );
  assert.equal(
    parseBotAvailableDaysBody({ ...baseDays, month: 202608 }).ok,
    false,
  );

  assert.equal(
    parseBotSlotsBody({ ...baseSlots, date: "2026-08-32" }).ok,
    false,
  );
  assert.equal(
    parseBotSlotsBody({ ...baseSlots, date: "2026-02-30" }).ok,
    false,
  );
  assert.equal(
    parseBotSlotsBody({ ...baseSlots, date: "2026-8-10" }).ok,
    false,
  );
  assert.equal(
    parseBotSlotsBody({ ...baseSlots, date: " 2026-08-10" }).ok,
    false,
  );
  assert.equal(
    parseBotSlotsBody({ ...baseSlots, date: "2026-08-10T00:00:00" }).ok,
    false,
  );
}

async function testDtoProjectionAndSlotId(): Promise<void> {
  const {
    projectBotAvailableDays,
    projectBotAvailableSlots,
    buildBotSlotId,
    BOT_INTERNAL_MAX_AVAILABLE_DATE_KEYS,
    BOT_INTERNAL_MAX_AVAILABLE_SLOTS,
  } = await loadAvailability();

  const daysOk = projectBotAvailableDays({
    serviceId: S1,
    masterId: M1,
    month: "2026-08",
    studioToday: "2026-08-05",
    dateKeys: ["2026-08-12", "2026-08-10", "2026-08-11"],
  });
  assert.equal(daysOk.ok, true);
  if (daysOk.ok) {
    assert.deepEqual(daysOk.value.dateKeys, [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
    assert.equal(daysOk.value.ok, true);
    assert.equal(daysOk.value.serviceId, S1);
    assert.equal(daysOk.value.masterId, M1);
    assert.equal(daysOk.value.month, "2026-08");
    assert.equal(daysOk.value.studioToday, "2026-08-05");
    assert.equal("price" in daysOk.value, false);
    assert.equal("comment" in daysOk.value, false);
  }

  assert.equal(
    projectBotAvailableDays({
      serviceId: S1,
      masterId: M1,
      month: "2026-08",
      studioToday: "2026-08-05",
      dateKeys: ["2026-08-10", "2026-08-10"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableDays({
      serviceId: S1,
      masterId: M1,
      month: "2026-08",
      studioToday: "2026-08-05",
      dateKeys: ["2026-08-32"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableDays({
      serviceId: S1,
      masterId: M1,
      month: "2026-08",
      studioToday: "2026-08-05",
      dateKeys: Array.from(
        { length: BOT_INTERNAL_MAX_AVAILABLE_DATE_KEYS + 1 },
        (_, i) => {
          if (i < 31) {
            return `2026-01-${String(i + 1).padStart(2, "0")}`;
          }
          return "2026-02-01";
        },
      ),
    }).ok,
    false,
  );

  const slotsOk = projectBotAvailableSlots({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    studioToday: "2026-08-05",
    times: ["11:00", "09:00", "10:30"],
  });
  assert.equal(slotsOk.ok, true);
  if (slotsOk.ok) {
    assert.deepEqual(
      slotsOk.value.slots.map((slot) => slot.startsAt),
      [
        "2026-08-10T09:00:00+05:00",
        "2026-08-10T10:30:00+05:00",
        "2026-08-10T11:00:00+05:00",
      ],
    );
    for (const slot of slotsOk.value.slots) {
      assert.equal(slot.serviceId, S1);
      assert.equal(slot.masterId, M1);
      assert.match(slot.startsAt, /\+05:00$/);
      assert.equal(slot.slotId, buildBotSlotId({
        serviceId: S1,
        masterId: M1,
        dateKey: "2026-08-10",
        startTime: slot.startsAt.slice(11, 16),
      }));
    }
    const serialized = JSON.stringify(slotsOk.value);
    assert.equal(serialized.includes("phone"), false);
    assert.equal(serialized.includes("comment"), false);
    assert.equal(serialized.includes("price"), false);
    assert.equal(serialized.includes("Authorization"), false);
    assert.equal(serialized.includes("Bearer"), false);
  }

  assert.equal(
    projectBotAvailableSlots({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      studioToday: "2026-08-05",
      times: ["09:00", "09:00"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableSlots({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      studioToday: "2026-08-05",
      times: ["9:00"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableSlots({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      studioToday: "2026-08-05",
      times: ["25:00"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableSlots({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      studioToday: "2026-08-05",
      times: ["not-a-time"],
    }).ok,
    false,
  );
  assert.equal(
    projectBotAvailableSlots({
      serviceId: S1,
      masterId: M1,
      dateKey: "2026-08-10",
      studioToday: "2026-08-05",
      times: Array.from(
        { length: BOT_INTERNAL_MAX_AVAILABLE_SLOTS + 1 },
        (_, i) => {
          const minutes = i % (24 * 60);
          const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
          const mm = String(minutes % 60).padStart(2, "0");
          // Force unique via impossible overflow path — duplicates would also fail.
          return `${hh}:${mm}`;
        },
      ).concat(["23:59"]),
    }).ok,
    false,
  );

  const idA = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "09:00",
  });
  const idA2 = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "09:00",
  });
  const idB = buildBotSlotId({
    serviceId: S2,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "09:00",
  });
  const idC = buildBotSlotId({
    serviceId: S1,
    masterId: M2,
    dateKey: "2026-08-10",
    startTime: "09:00",
  });
  const idD = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-11",
    startTime: "09:00",
  });
  const idE = buildBotSlotId({
    serviceId: S1,
    masterId: M1,
    dateKey: "2026-08-10",
    startTime: "10:00",
  });
  assert.equal(idA, idA2);
  assert.notEqual(idA, idB);
  assert.notEqual(idA, idC);
  assert.notEqual(idA, idD);
  assert.notEqual(idA, idE);
  assert.doesNotMatch(idA, /Bearer|token|phone|\+/i);
}

async function testEvaluateUsesOnlyServiceTimesAndSharedNow(): Promise<void> {
  const {
    evaluateBotAvailableDays,
    evaluateBotAvailableSlots,
  } = await loadAvailability();

  const fixedNow = new Date("2026-08-05T10:00:00+05:00");
  let daysNowSeen: Date | undefined;
  let slotsNowSeen: Date | undefined;
  let daysCalls = 0;
  let slotsCalls = 0;

  const days = await evaluateBotAvailableDays(
    { serviceId: S1, masterId: M1, month: "2026-08" },
    "2026-08-05",
    fixedNow,
    {
      async getAvailableDaysInMonth(_m, _s, _month, _today, options) {
        daysCalls += 1;
        daysNowSeen = options?.now;
        return ["2026-08-20", "2026-08-15"];
      },
    },
  );
  assert.equal(days.ok, true);
  assert.equal(daysCalls, 1);
  assert.equal(daysNowSeen, fixedNow);
  if (days.ok) {
    assert.deepEqual(days.value.dateKeys, ["2026-08-15", "2026-08-20"]);
  }

  const slots = await evaluateBotAvailableSlots(
    { serviceId: S1, masterId: M1, date: "2026-08-10" },
    "2026-08-05",
    fixedNow,
    {
      async getAvailableTimeSlots(_m, _s, _d, _today, options) {
        slotsCalls += 1;
        slotsNowSeen = options?.now;
        return ["14:00", "13:00"];
      },
    },
  );
  assert.equal(slots.ok, true);
  assert.equal(slotsCalls, 1);
  assert.equal(slotsNowSeen, fixedNow);
  if (slots.ok) {
    assert.deepEqual(
      slots.value.slots.map((slot) => slot.startsAt.slice(11, 16)),
      ["13:00", "14:00"],
    );
    // Route/projector invents nothing beyond BookingService times.
    assert.equal(slots.value.slots.length, 2);
  }

  const { OnlineServiceUnavailableError } = await loadBooking();
  const { AppointmentValidationError } = await import(
    "../src/services/AppointmentService"
  );

  const unavailable = await evaluateBotAvailableSlots(
    { serviceId: S1, masterId: M1, date: "2026-08-10" },
    "2026-08-05",
    fixedNow,
    {
      async getAvailableTimeSlots() {
        throw new OnlineServiceUnavailableError();
      },
    },
  );
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.code, "SERVICE_UNAVAILABLE");
  }

  const pairClosed = await evaluateBotAvailableDays(
    { serviceId: S1, masterId: M1, month: "2026-08" },
    "2026-08-05",
    fixedNow,
    {
      async getAvailableDaysInMonth() {
        throw new AppointmentValidationError("pair closed");
      },
    },
  );
  assert.equal(pairClosed.ok, false);
  if (!pairClosed.ok) {
    assert.equal(pairClosed.code, "SERVICE_UNAVAILABLE");
  }

  await assert.rejects(
    () =>
      evaluateBotAvailableSlots(
        { serviceId: S1, masterId: M1, date: "2026-08-10" },
        "2026-08-05",
        fixedNow,
        {
          async getAvailableTimeSlots() {
            throw new Error("boom-secret-db-url postgresql://x");
          },
        },
      ),
    /boom-secret-db-url/,
  );
}

async function testErrorMappingNoLeak(): Promise<void> {
  const {
    botAvailabilityServiceUnavailableResponse,
    botAvailabilityInternalErrorResponse,
    botAvailabilityValidationResponse,
    BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS,
    mapBotAvailabilityDomainResult,
  } = await loadAvailability();
  const {
    ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
    SERVICE_UNAVAILABLE_CODE,
  } = await import("../src/lib/booking/public-booking-errors");
  const { mapPublicAvailabilityError } = await import(
    "../src/lib/booking/public-availability-route"
  );
  const { OnlineServiceUnavailableError } = await loadBooking();

  // Chosen HTTP status matches public availability contract.
  const publicMapped = mapPublicAvailabilityError(
    "test",
    new OnlineServiceUnavailableError(),
  );
  assert.equal(publicMapped.status, 400);
  assert.equal(BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS, 400);
  assert.equal(publicMapped.status, BOT_AVAILABILITY_SERVICE_UNAVAILABLE_HTTP_STATUS);

  const unavailable = botAvailabilityServiceUnavailableResponse();
  assert.equal(unavailable.status, 400);
  const unavailableBody = await readJson(unavailable);
  assert.deepEqual(unavailableBody, {
    ok: false,
    code: SERVICE_UNAVAILABLE_CODE,
    error: ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
  });
  assert.equal(JSON.stringify(unavailableBody).includes(M1), false);
  assert.equal(JSON.stringify(unavailableBody).includes("STUDIO"), false);
  assert.equal(JSON.stringify(unavailableBody).includes("reasonCode"), false);

  const validation = botAvailabilityValidationResponse("Invalid serviceId");
  assert.equal(validation.status, 400);
  const validationBody = await readJson(validation);
  assert.equal(validationBody.code, "VALIDATION_ERROR");
  assert.equal("stack" in validationBody, false);

  const payload = botAvailabilityValidationResponse("Payload too large", 413);
  assert.equal(payload.status, 413);
  assert.equal((await readJson(payload)).code, "PAYLOAD_TOO_LARGE");

  const internal = botAvailabilityInternalErrorResponse(
    "bot-internal-slots-test",
    new Error(`leak ${M1} Authorization Bearer ${TOKEN}`),
  );
  assert.equal(internal.status, 500);
  const internalBody = await readJson(internal);
  assert.deepEqual(internalBody, {
    ok: false,
    code: "INTERNAL_ERROR",
    error: "Internal error",
  });
  assert.equal(JSON.stringify(internalBody).includes(TOKEN), false);
  assert.equal(JSON.stringify(internalBody).includes(M1), false);

  const mapped = mapBotAvailabilityDomainResult("scope", {
    ok: false,
    code: "SERVICE_UNAVAILABLE",
  });
  assert.equal(mapped.status, 400);
}

async function testMorningCutoffPolicyParity(): Promise<void> {
  const cutoff = await loadMorningCutoff();
  const before = new Date("2026-08-09T20:59:00+05:00");
  const at = new Date("2026-08-09T21:00:00+05:00");
  const after = new Date("2026-08-09T21:00:01+05:00");

  assert.equal(
    cutoff.isPublicMorningSlotBlocked({
      slotDateKey: "2026-08-10",
      startTime: "09:00",
      now: before,
    }),
    false,
  );
  assert.equal(
    cutoff.isPublicMorningSlotBlocked({
      slotDateKey: "2026-08-10",
      startTime: "09:00",
      now: at,
    }),
    true,
  );
  assert.equal(
    cutoff.isPublicMorningSlotBlocked({
      slotDateKey: "2026-08-10",
      startTime: "09:00",
      now: after,
    }),
    true,
  );
  assert.equal(
    cutoff.isPublicMorningSlotBlocked({
      slotDateKey: "2026-08-10",
      startTime: "12:00",
      now: after,
    }),
    false,
  );

  // Bot routes must pass BookingService the same shared now (static + evaluate).
  const booking = read("src/services/BookingService.ts");
  assert.match(
    booking,
    /export async function getAvailableTimeSlots[\s\S]*isPublicMorningSlotBlocked/,
  );
  assert.match(
    stripComments(read("src/app/api/internal/bot/v1/slots/route.ts")),
    /const now = getStudioNow\(\)[\s\S]*evaluateBotAvailableSlots\([\s\S]*now/,
  );
  assert.match(
    stripComments(read("src/app/api/internal/bot/v1/available-days/route.ts")),
    /const now = getStudioNow\(\)[\s\S]*evaluateBotAvailableDays\([\s\S]*now/,
  );
}

async function testUnauthorizedDoesNotCallBookingService(): Promise<void> {
  const { withBotInternalApi } = await import("../src/lib/auth/bot-internal-api");
  let domainCalls = 0;

  const handler = withBotInternalApi(async () => {
    domainCalls += 1;
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ ok: true });
  });

  await withTokenEnv(undefined, async () => {
    const response = await handler(
      new Request("http://localhost/api/internal/bot/v1/available-days", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId: S1,
          masterId: M1,
          month: "2026-08",
        }),
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(domainCalls, 0);
  });

  await withTokenEnv(TOKEN, async () => {
    // Rate limit may still fire; ensure auth success reaches handler when RL allows.
    process.env.WHEEL_E2E_ISOLATED = "1";
    try {
      const response = await handler(
        new Request("http://localhost/api/internal/bot/v1/available-days", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            serviceId: S1,
            masterId: M1,
            month: "2026-08",
          }),
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(domainCalls, 1);
    } finally {
      delete process.env.WHEEL_E2E_ISOLATED;
    }
  });
}

async function testPolicyErrorsMapWithoutReasonLeak(): Promise<void> {
  const { evaluateBotAvailableSlots, mapBotAvailabilityDomainResult } =
    await loadAvailability();
  const { OnlineServiceUnavailableError, getAvailableTimeSlots } =
    await loadBooking();
  const { AppointmentValidationError } = await import(
    "../src/services/AppointmentService"
  );
  const now = new Date("2026-08-05T12:00:00+05:00");

  const cases: Array<{ name: string; error: Error }> = [
    { name: "studio-kill-switch", error: new OnlineServiceUnavailableError() },
    {
      name: "service-inactive",
      error: new OnlineServiceUnavailableError(),
    },
    {
      name: "master-closed",
      error: new AppointmentValidationError("master closed"),
    },
    {
      name: "timing-missing",
      error: new AppointmentValidationError("timing"),
    },
  ];

  for (const testCase of cases) {
    const result = await evaluateBotAvailableSlots(
      { serviceId: S1, masterId: M1, date: "2026-08-10" },
      "2026-08-05",
      now,
      {
        async getAvailableTimeSlots() {
          throw testCase.error;
        },
      },
    );
    assert.equal(result.ok, false, testCase.name);
    if (!result.ok) {
      assert.equal(result.code, "SERVICE_UNAVAILABLE", testCase.name);
    }
    const response = mapBotAvailabilityDomainResult("policy-test", result);
    assert.equal(response.status, 400, testCase.name);
    const body = await readJson(response);
    assert.equal(body.code, "SERVICE_UNAVAILABLE", testCase.name);
    assert.equal("reasonCode" in body, false, testCase.name);
    assert.equal(JSON.stringify(body).includes("master closed"), false);
    assert.equal(JSON.stringify(body).includes("timing"), false);
  }

  // Real BookingService.assertOnlineBookable policy matrix via DI (no DB slot load —
  // throws before loadSlotContext).
  type PolicyCase = {
    name: string;
    studioEnabled?: boolean;
    service?: {
      isActive: boolean;
      isPublic: boolean;
      isOnlineBookingEnabled: boolean;
      category: { isActive: boolean; isPublic: boolean } | null;
    } | null;
    master?: {
      isActive: boolean;
      isPublic: boolean;
      isOnlineBookingEnabled: boolean;
    } | null;
    link?: {
      isEnabled: boolean;
      isPublic: boolean;
      isOnlineBookingEnabled: boolean;
    } | null;
    timingOk?: boolean;
  };

  const eligibleService = {
    id: S1,
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
    category: { isActive: true, isPublic: true },
  };
  const eligibleMaster = {
    id: M1,
    isActive: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
  };
  const eligibleLink = {
    isEnabled: true,
    isPublic: true,
    isOnlineBookingEnabled: true,
  };

  const policyCases: PolicyCase[] = [
    { name: "studio-off", studioEnabled: false },
    {
      name: "service-inactive",
      service: { ...eligibleService, isActive: false },
    },
    {
      name: "service-private",
      service: { ...eligibleService, isPublic: false },
    },
    {
      name: "service-online-disabled",
      service: { ...eligibleService, isOnlineBookingEnabled: false },
    },
    {
      name: "category-inactive",
      service: {
        ...eligibleService,
        category: { isActive: false, isPublic: true },
      },
    },
    {
      name: "category-private",
      service: {
        ...eligibleService,
        category: { isActive: true, isPublic: false },
      },
    },
    {
      name: "master-inactive",
      master: { ...eligibleMaster, isActive: false },
    },
    {
      name: "master-private",
      master: { ...eligibleMaster, isPublic: false },
    },
    {
      name: "master-online-disabled",
      master: { ...eligibleMaster, isOnlineBookingEnabled: false },
    },
    {
      name: "link-disabled",
      link: { ...eligibleLink, isEnabled: false },
    },
    {
      name: "link-private",
      link: { ...eligibleLink, isPublic: false },
    },
    {
      name: "link-online-disabled",
      link: { ...eligibleLink, isOnlineBookingEnabled: false },
    },
    { name: "timing-missing", timingOk: false },
  ];

  for (const policy of policyCases) {
    const service = policy.service === undefined ? eligibleService : policy.service;
    const master = policy.master === undefined ? eligibleMaster : policy.master;
    const link = policy.link === undefined ? eligibleLink : policy.link;
    const timingOk = policy.timingOk ?? true;
    const studioEnabled = policy.studioEnabled ?? true;

    const runtime = {
      db: {
        service: {
          async findUnique() {
            return service;
          },
        },
        master: {
          async findUnique() {
            return master;
          },
        },
        masterService: {
          async findUnique() {
            return link;
          },
        },
      },
      async resolveTiming() {
        return timingOk
          ? {
              durationMinutes: 60,
              breakAfterMinutes: 0,
              totalBusyMinutes: 60,
              source: "service" as const,
            }
          : null;
      },
      async isStudioOnlineBookingEnabled() {
        return studioEnabled;
      },
    };

    const result = await evaluateBotAvailableSlots(
      { serviceId: S1, masterId: M1, date: "2026-08-10" },
      "2026-08-05",
      now,
      {
        getAvailableTimeSlots,
        slotOptions: {
          bookingPolicyRuntime: runtime as never,
          // Avoid any post-policy DB work if assert somehow passed.
          loadOnlineFillTimings: async () => [],
          preloadedOnlineTimings: [],
        },
      },
    );
    assert.equal(result.ok, false, policy.name);
    if (!result.ok) {
      assert.equal(result.code, "SERVICE_UNAVAILABLE", policy.name);
    }
    const response = mapBotAvailabilityDomainResult("policy-di", result);
    const body = await readJson(response);
    assert.equal(response.status, 400, policy.name);
    assert.equal(body.code, "SERVICE_UNAVAILABLE", policy.name);
    assert.equal(JSON.stringify(body).includes(policy.name), false);
    assert.equal("reasonCode" in body, false);
  }
}

async function main(): Promise<void> {
  try {
    testStaticRouteWiring();
    await testRouteCoverageIncludesNewRoutes();
    await testAuthBeforeBodyAndTransport();
    await testUnauthorizedDoesNotCallBookingService();
    await testValidationParsers();
    await testDtoProjectionAndSlotId();
    await testEvaluateUsesOnlyServiceTimesAndSharedNow();
    await testErrorMappingNoLeak();
    await testMorningCutoffPolicyParity();
    await testPolicyErrorsMapWithoutReasonLeak();
    console.error = originalConsoleError;
    console.log("security-bot-internal-availability-check: OK");
  } catch (error) {
    console.error = originalConsoleError;
    throw error;
  }
}

main().catch((error) => {
  console.error = originalConsoleError;
  console.error(error);
  process.exitCode = 1;
});
