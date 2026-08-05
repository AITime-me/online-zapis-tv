/**
 * CURSOR-15 Stage 4G — disabled-state available-days/slots must map
 * OnlineServiceUnavailableError to public HTTP 400 + SERVICE_UNAVAILABLE
 * (parity with booking create), while unexpected errors stay sanitized 500.
 */
process.env.SECURITY_BATCH_TEST = "1";
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/tvoe_vremya_security_batch";
process.env.AUTH_SECRET = "cursor15-stage4g-auth-secret-32chars-min!!";
process.env.AUTH_URL = "https://staging.example.test";
process.env.SCHEDULE_VIEW_TOKEN = "cursor15-stage4g-schedule-token-32chars!";
process.env.APP_ENV = "staging";
process.env.NODE_ENV = "production";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const serverOnlyMarker = require.resolve("server-only");
const serverOnlyEmpty = path.join(path.dirname(serverOnlyMarker), "empty.js");
require(serverOnlyEmpty);
require.cache[serverOnlyMarker] = require.cache[serverOnlyEmpty];

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

function testRouteWiringStatic(): void {
  const days = stripComments(read("src/app/api/booking/available-days/route.ts"));
  const slots = stripComments(read("src/app/api/booking/slots/route.ts"));
  const helper = stripComments(
    read("src/lib/booking/public-availability-route.ts"),
  );
  const create = stripComments(read("src/app/api/booking/create/route.ts"));

  assert.match(days, /withPublicAvailabilityErrors/);
  assert.match(slots, /withPublicAvailabilityErrors/);
  assert.match(days, /getAvailableDaysInMonth/);
  assert.match(slots, /getAvailableTimeSlots/);

  // Preserve public morning slot cutoff wiring from current main.
  assert.match(days, /const\s+now\s*=\s*getStudioNow\(\)/);
  assert.match(slots, /const\s+now\s*=\s*getStudioNow\(\)/);
  assert.match(days, /formatStudioDateKey\(\s*now\s*\)/);
  assert.match(slots, /formatStudioDateKey\(\s*now\s*\)/);
  assert.match(
    days,
    /getAvailableDaysInMonth\([\s\S]*\{\s*now\s*,?\s*\}/,
  );
  assert.match(
    slots,
    /getAvailableTimeSlots\([\s\S]*\{\s*now\s*,?\s*\}/,
  );

  assert.match(helper, /error\s+instanceof\s+OnlineServiceUnavailableError/);
  assert.match(helper, /status:\s*400/);
  assert.match(helper, /status:\s*500/);
  assert.match(helper, /toApiErrorBody\(error,\s*\{\s*includeStack:\s*false\s*\}\)/);

  assert.match(
    days,
    /import\s*\{[^}]*withPublicAvailabilityErrors[^}]*\}\s*from\s*["']@\/lib\/booking\/public-availability-route["']/,
  );
  assert.match(
    slots,
    /import\s*\{[^}]*withPublicAvailabilityErrors[^}]*\}\s*from\s*["']@\/lib\/booking\/public-availability-route["']/,
  );

  assert.match(
    create,
    /if\s*\(\s*error\s+instanceof\s+OnlineServiceUnavailableError\s*\)/,
  );
  assert.match(create, /errorResponse\(\s*error\.message\s*,\s*400/);
  assert.match(create, /code:\s*error\.name/);
}

function testKillSwitchStaticStillPresent(): void {
  const booking = stripComments(read("src/services/BookingService.ts"));
  assert.match(booking, /export async function assertStudioOnlineBookingEnabled/);
  assert.match(booking, /throw new OnlineServiceUnavailableError\(\)/);
  assert.match(
    booking,
    /export async function getAvailableDaysInMonth[\s\S]*await assertStudioOnlineBookingEnabled/,
  );
  assert.match(
    booking,
    /export async function getAvailableTimeSlots[\s\S]*assertOnlineBookable/,
  );
}

function testNoStudioReasonLeakInPublicAvailabilityHelper(): void {
  const helper = read("src/lib/booking/public-availability-route.ts");
  assert.equal(helper.includes("STUDIO_ONLINE_DISABLED"), false);
  assert.equal(helper.includes("reasonCode"), false);
}

async function main(): Promise<void> {
  testRouteWiringStatic();
  testKillSwitchStaticStillPresent();
  testNoStudioReasonLeakInPublicAvailabilityHelper();

  const {
    mapPublicAvailabilityError,
    withPublicAvailabilityErrors,
  } = await import("../src/lib/booking/public-availability-route");
  const {
    ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
    SERVICE_UNAVAILABLE_CODE,
  } = await import("../src/lib/booking/public-booking-errors");
  const {
    OnlineServiceUnavailableError,
  } = await import("../src/services/BookingService");
  const { AppointmentValidationError } = await import(
    "../src/services/AppointmentService"
  );
  const { NextResponse } = await import("next/server");

  assert.equal(SERVICE_UNAVAILABLE_CODE, "SERVICE_UNAVAILABLE");
  const sample = new OnlineServiceUnavailableError();
  assert.equal(sample.name, SERVICE_UNAVAILABLE_CODE);
  assert.equal(sample.message, ONLINE_SERVICE_UNAVAILABLE_MESSAGE);

  {
    const response = mapPublicAvailabilityError(
      "test/available-days",
      new OnlineServiceUnavailableError(),
    );
    assert.equal(response.status, 400);
    const body = await readJson(response);
    assert.equal(body.ok, false);
    assert.equal(body.code, SERVICE_UNAVAILABLE_CODE);
    assert.equal(body.error, ONLINE_SERVICE_UNAVAILABLE_MESSAGE);
    assert.equal("dateKeys" in body, false);
    assert.equal("slots" in body, false);
    assert.equal("stack" in body, false);
    assert.equal("reasonCode" in body, false);
    assert.equal(
      JSON.stringify(body).includes("STUDIO_ONLINE_DISABLED"),
      false,
    );
  }

  {
    const response = mapPublicAvailabilityError(
      "test/slots",
      new AppointmentValidationError("pair unavailable"),
    );
    assert.equal(response.status, 500);
    const body = await readJson(response);
    assert.equal(body.ok, false);
    assert.notEqual(body.code, SERVICE_UNAVAILABLE_CODE);
    assert.equal("stack" in body, false);
  }

  {
    const response = mapPublicAvailabilityError(
      "test/slots",
      new Error("boom-internal"),
    );
    assert.equal(response.status, 500);
    const body = await readJson(response);
    assert.equal(body.ok, false);
    assert.notEqual(body.code, SERVICE_UNAVAILABLE_CODE);
    assert.equal("stack" in body, false);
    assert.equal("dateKeys" in body, false);
    assert.equal("slots" in body, false);
  }

  {
    const response = await withPublicAvailabilityErrors(
      "test/available-days",
      async () => ["2026-08-10"],
      (dateKeys) => NextResponse.json({ ok: true, dateKeys }),
    );
    assert.equal(response.status, 200);
    const body = await readJson(response);
    assert.equal(body.ok, true);
    assert.deepEqual(body.dateKeys, ["2026-08-10"]);
  }

  {
    const response = await withPublicAvailabilityErrors(
      "test/slots",
      async () => {
        throw new OnlineServiceUnavailableError();
      },
      () => {
        throw new Error("success path must not run");
      },
    );
    assert.equal(response.status, 400);
    const body = await readJson(response);
    assert.equal(body.code, SERVICE_UNAVAILABLE_CODE);
    assert.equal("slots" in body, false);
  }

  {
    const response = await withPublicAvailabilityErrors(
      "test/available-days",
      async () => {
        throw new Error("unexpected");
      },
      () => {
        throw new Error("success path must not run");
      },
    );
    assert.equal(response.status, 500);
    const body = await readJson(response);
    assert.notEqual(body.code, SERVICE_UNAVAILABLE_CODE);
  }

  console.log("security-disabled-availability-4xx-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
