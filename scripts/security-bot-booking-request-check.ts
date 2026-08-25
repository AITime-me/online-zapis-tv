/**
 * Phase 1 — bot BookingRequest S2S (feed/get/availability/lookup/book).
 * Static architecture + parser + policy checks (no DB).
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
process.env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET ??=
  "security-batch-bot-booking-request-hmac-secret-32chars!!";

const originalConsoleError = console.error;
console.error = () => {};

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "22222222-2222-4222-8222-111111111111";
const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

assert.ok(isCanonicalUuid(R1));
assert.ok(isCanonicalUuid(KEY));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTE_RELS = [
  "src/app/api/internal/bot/v1/booking-requests/feed/route.ts",
  "src/app/api/internal/bot/v1/booking-requests/get/route.ts",
  "src/app/api/internal/bot/v1/booking-requests/availability/route.ts",
  "src/app/api/internal/bot/v1/booking-requests/appointments-lookup/route.ts",
  "src/app/api/internal/bot/v1/booking-requests/book/route.ts",
] as const;

function testStaticRouteWiring(): void {
  for (const rel of ROUTE_RELS) {
    const source = read(rel);
    assert.match(
      source,
      /import \{ withBotInternalApi \} from "@\/lib\/auth\/bot-internal-api"/,
      `${rel} exact wrapper import`,
    );
    assert.match(source, /export const POST = withBotInternalApi/);
    assert.match(source, /readBoundedJsonBody/);
    assert.match(source, /BOT_INTERNAL_MAX_JSON_BODY_BYTES/);
    assert.match(source, /isExactApplicationJsonContentType/);
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.match(source, /export const revalidate = 0/);
    assert.match(source, /safeLogError/);
    assert.doesNotMatch(source, /console\.(log|info|debug|error)/);
    assert.doesNotMatch(source, /prisma\./);
    assert.doesNotMatch(source, /assertOnlineBookable/);
    assert.doesNotMatch(source, /ChangeEvent|changeEvent/);
    assert.ok(
      source.indexOf("withBotInternalApi") < source.indexOf("readBoundedJsonBody"),
      `${rel}: auth before body`,
    );
  }

  const book = read(
    "src/app/api/internal/bot/v1/booking-requests/book/route.ts",
  );
  assert.match(book, /rateLimitPolicy:\s*"botInternalBookingCreate"/);
  assert.match(book, /parseBotBookingRequestBookBody/);
  assert.match(book, /bookBotBookingRequest/);

  const feed = read(
    "src/app/api/internal/bot/v1/booking-requests/feed/route.ts",
  );
  assert.match(feed, /feedBotBookingRequests/);
  assert.doesNotMatch(stripComments(feed), /status:\s*"CONTACTED"|update\(/);

  for (const pathname of [
    "/api/internal/bot/v1/booking-requests/feed",
    "/api/internal/bot/v1/booking-requests/get",
    "/api/internal/bot/v1/booking-requests/availability",
    "/api/internal/bot/v1/booking-requests/appointments-lookup",
    "/api/internal/bot/v1/booking-requests/book",
  ]) {
    assert.equal(requiresAdminCsrfProtection(pathname, "POST"), false);
  }

  assert.equal(
    resolveApiRateLimitPolicy(
      "/api/internal/bot/v1/booking-requests/book",
      "POST",
    ),
    "botInternalBookingCreate",
  );
  assert.equal(
    resolveApiRateLimitPolicy(
      "/api/internal/bot/v1/booking-requests/feed",
      "POST",
    ),
    "botInternal",
  );
  assert.equal(
    resolveApiRateLimitPolicy(
      "/api/internal/bot/v1/booking-requests/availability",
      "POST",
    ),
    "botInternal",
  );

  const inventory = read("src/lib/security/rate-limit/route-rules.ts");
  assert.match(inventory, /\/api\/internal\/bot\/v1\/booking-requests\/book/);
  assert.match(inventory, /\/api\/internal\/bot\/v1\/booking-requests\/feed/);
}

async function testRouteCoverageIncludesNewRoutes(): Promise<void> {
  const coverage = await import("./security-bot-internal-route-coverage-check");
  const routes = coverage.assertBotInternalRouteCoverage();
  const normalized = routes.map((route) => route.replace(/\\/g, "/"));
  for (const suffix of [
    "booking-requests/feed/route.ts",
    "booking-requests/get/route.ts",
    "booking-requests/availability/route.ts",
    "booking-requests/appointments-lookup/route.ts",
    "booking-requests/book/route.ts",
  ]) {
    assert.ok(
      normalized.some((route) => route.endsWith(suffix)),
      `coverage missing ${suffix}`,
    );
  }
}

function testStaticArchitecture(): void {
  const availability = read("src/lib/bot-api/booking-request-availability.ts");
  const availabilityCode = stripComments(availability);
  assert.match(availability, /import "server-only"/);
  assert.match(availability, /checkMasterIntervalAvailability/);
  assert.match(availability, /buildBotSlotId/);
  assert.match(availability, /resolveMasterWorkHours/);
  assert.match(availability, /resolveServiceTimingForMaster/);
  assert.doesNotMatch(
    availabilityCode,
    /from ["']@\/services\/BookingService["']/,
  );
  assert.doesNotMatch(availabilityCode, /\bassertOnlineBookable\b/);
  assert.doesNotMatch(availabilityCode, /\bgetAvailableTimeSlots\b/);
  assert.doesNotMatch(availabilityCode, /isOnlineBookingEnabled:\s*true/);
  assert.match(
    availability,
    /Request-only: include every extra window/,
  );

  const service = read("src/services/BotBookingRequestService.ts");
  const serviceCode = stripComments(service);
  assert.match(service, /import "server-only"/);
  assert.match(service, /createBotRequestAppointment/);
  assert.match(service, /BOOKING_REQUEST_BOOK_OPERATION_KIND|booking_request_book/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /RECONCILIATION_REQUIRED/);
  assert.match(service, /CONSULTATION_SERVICE_REQUIRED/);
  assert.match(service, /buildGameBookingRequestDisplay/);
  assert.match(service, /managerConfirmationRequired:\s*true/);
  assert.doesNotMatch(serviceCode, /\bassertOnlineBookable\b/);
  assert.doesNotMatch(serviceCode, /\bcreateBotOnlineAppointment\b/);
  assert.doesNotMatch(serviceCode, /\bChangeEvent\b|\bchangeEvent\b/);
  assert.doesNotMatch(service, /console\.(log|info|debug)/);
  // clientPhone is in DTO for CRM — must not be logged.
  assert.doesNotMatch(
    serviceCode,
    /safeLogError\([^)]*clientPhone|console\.[^(]*clientPhone/,
  );

  const appointment = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(appointment, /export async function createBotRequestAppointment/);
  assert.match(
    appointment,
    /createBotRequestAppointment[\s\S]*servicePolicy:\s*"INTERNAL"/,
  );
  assert.match(
    appointment,
    /createBotRequestAppointment[\s\S]*source:\s*"BOT"/,
  );

  const idem = read("src/lib/bot-api/booking-request-idempotency.ts");
  const idemCode = stripComments(idem);
  assert.match(idem, /import "server-only"/);
  assert.match(idem, /BOOKING_REQUEST_BOOK_OPERATION_KIND = "booking_request_book"/);
  assert.match(idem, /claimInternalBotOperationIdempotency/);
  assert.doesNotMatch(idemCode, /\bclientPhone\b|\bclientName\b|\bnormalizePhone\b/);

  const types = read("src/lib/bot-api/booking-request-types.ts");
  assert.match(types, /clientPhone/);
  assert.match(types, /never log/i);
  assert.match(types, /VALIDATION_ERROR/);
  assert.match(types, /RECONCILIATION_REQUIRED/);
  assert.match(types, /CONSULTATION_SERVICE_REQUIRED/);
}

async function testParsers(): Promise<void> {
  const {
    parseBotBookingRequestFeedBody,
    parseBotBookingRequestGetBody,
    parseBotBookingRequestAvailabilityBody,
    parseBotBookingRequestAppointmentsLookupBody,
    parseBotBookingRequestBookBody,
    parseBotBookingRequestStartsAt,
    isExactApplicationJsonContentType,
  } = await import("../src/lib/bot-api/booking-request-types");

  assert.equal(isExactApplicationJsonContentType("application/json"), true);
  assert.equal(
    isExactApplicationJsonContentType("application/json; charset=utf-8"),
    true,
  );
  assert.equal(isExactApplicationJsonContentType("text/plain"), false);

  const feedOk = parseBotBookingRequestFeedBody({});
  assert.equal(feedOk.ok, true);
  if (feedOk.ok) {
    assert.equal(feedOk.value.limit, 20);
  }

  const feedLimit = parseBotBookingRequestFeedBody({ limit: 51 });
  assert.equal(feedLimit.ok, false);

  const feedCursor = parseBotBookingRequestFeedBody({
    cursor: { createdAt: "2026-08-10T09:00:00.000Z", id: R1 },
  });
  assert.equal(feedCursor.ok, true);

  assert.equal(parseBotBookingRequestGetBody({ id: R1 }).ok, true);
  assert.equal(parseBotBookingRequestGetBody({ id: "nope" }).ok, false);

  assert.equal(
    parseBotBookingRequestAvailabilityBody({
      requestId: R1,
      date: "2026-08-10",
    }).ok,
    true,
  );
  assert.equal(
    parseBotBookingRequestAvailabilityBody({
      requestId: R1,
      month: "2026-08",
    }).ok,
    true,
  );
  assert.equal(
    parseBotBookingRequestAvailabilityBody({
      requestId: R1,
      date: "2026-08-10",
      month: "2026-08",
    }).ok,
    false,
  );

  assert.equal(
    parseBotBookingRequestAppointmentsLookupBody({ phone: "+79001234567" }).ok,
    true,
  );
  assert.equal(
    parseBotBookingRequestAppointmentsLookupBody({ clientId: R1 }).ok,
    true,
  );
  assert.equal(
    parseBotBookingRequestAppointmentsLookupBody({
      phone: "+79001234567",
      clientId: R1,
    }).ok,
    false,
  );

  const starts = parseBotBookingRequestStartsAt("2026-08-10T09:00:00+05:00");
  assert.equal(starts.ok, true);
  if (starts.ok) {
    assert.equal(starts.value.dateKey, "2026-08-10");
    assert.equal(starts.value.startTime, "09:00");
  }
  assert.equal(
    parseBotBookingRequestStartsAt("2026-08-10T09:00:00Z").ok,
    false,
  );

  const book = parseBotBookingRequestBookBody({
    requestId: R1,
    startsAt: "2026-08-10T09:00:00+05:00",
    idempotencyKey: KEY,
    serviceId: S1,
  });
  assert.equal(book.ok, true);
  if (book.ok) {
    assert.equal(book.value.dateKey, "2026-08-10");
    assert.equal(book.value.startTime, "09:00");
    assert.equal(book.value.serviceId, S1);
  }
}

async function testIdempotencyFingerprint(): Promise<void> {
  const {
    BOOKING_REQUEST_BOOK_OPERATION_KIND,
    computeBookingRequestBookFingerprintCandidates,
    sanitizeBookingRequestBookResultSnapshot,
    buildSafeBookingRequestBookResultSnapshot,
  } = await import("../src/lib/bot-api/booking-request-idempotency");

  assert.equal(BOOKING_REQUEST_BOOK_OPERATION_KIND, "booking_request_book");

  const a = computeBookingRequestBookFingerprintCandidates({
    requestId: R1,
    startsAt: "2026-08-10T09:00:00+05:00",
    serviceId: S1,
  });
  const a2 = computeBookingRequestBookFingerprintCandidates({
    requestId: R1,
    startsAt: "2026-08-10T09:00:00+05:00",
    serviceId: S1,
  });
  const b = computeBookingRequestBookFingerprintCandidates({
    requestId: R1,
    startsAt: "2026-08-10T10:00:00+05:00",
    serviceId: S1,
  });
  assert.equal(a.current, a2.current);
  assert.notEqual(a.current, b.current);

  const snap = buildSafeBookingRequestBookResultSnapshot({
    appointmentId: KEY,
    requestId: R1,
    startsAt: "2026-08-10T09:00:00+05:00",
    serviceId: S1,
    masterId: R1,
  });
  assert.deepEqual(sanitizeBookingRequestBookResultSnapshot(snap), snap);
  assert.equal(
    sanitizeBookingRequestBookResultSnapshot({
      ...snap,
      clientPhone: "+7900",
    }),
    null,
  );
}

async function main(): Promise<void> {
  testStaticRouteWiring();
  await testRouteCoverageIncludesNewRoutes();
  testStaticArchitecture();
  await testParsers();
  await testIdempotencyFingerprint();

  console.error = originalConsoleError;
  console.log("security-bot-booking-request-check: ok");
}

main().catch((error) => {
  console.error = originalConsoleError;
  console.error(error);
  process.exitCode = 1;
});
