/** Phase 1 regression: every availability path resolves one central busy range. */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getAppointmentBusyInterval,
  resolveApplicableBreakMinutes,
  type AppointmentBusyTimingSnapshot,
} from "../src/lib/schedule/appointment-busy";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { checkMasterIntervalAvailability } from "../src/services/MasterAvailabilityService";

const ROOT = process.cwd();
const DATE_KEY = "2026-07-20";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function at(time: string): Date {
  const value = parseStudioDateKey(DATE_KEY, time);
  assert.ok(value, `parseStudioDateKey(${DATE_KEY}, ${time})`);
  return value;
}

function snapshot(
  overrides: Partial<AppointmentBusyTimingSnapshot> = {},
): AppointmentBusyTimingSnapshot {
  return {
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    timingSemanticsVersion: 1,
    breakAfterMinutes: 30,
    standardBreakAfterMinutes: 20,
    standardDurationMinutes: 120,
    isManualTimeOverride: true,
    ...overrides,
  };
}

function assertBusyEnd(
  value: AppointmentBusyTimingSnapshot,
  expected: string,
  message: string,
): void {
  assert.equal(
    getAppointmentBusyInterval(value).endsAt.getTime(),
    at(expected).getTime(),
    message,
  );
}

function testResolverSemantics(): void {
  assertBusyEnd(
    snapshot(),
    "12:30",
    "v1 retains residual standard-duration floor and one break",
  );
  assertBusyEnd(
    snapshot({ timingSemanticsVersion: 2, endsAt: at("11:20") }),
    "11:20",
    "v2 endsAt is already free-at and must not receive another break",
  );
  assertBusyEnd(
    snapshot({ breakAfterMinutes: null, standardBreakAfterMinutes: 20 }),
    "12:20",
    "standard break is used when applied break is absent",
  );
  assert.equal(
    resolveApplicableBreakMinutes(-10, -5),
    0,
    "negative breaks are safely normalized",
  );
  assertBusyEnd(
    snapshot({ standardDurationMinutes: null }),
    "11:40",
    "missing standard duration falls back to stored procedure end plus break",
  );
  assertBusyEnd(
    snapshot({ standardDurationMinutes: Number.NaN }),
    "11:40",
    "invalid standard duration falls back to stored procedure end plus break",
  );
  assertBusyEnd(
    snapshot({ timingSemanticsVersion: 999 }),
    "12:30",
    "unknown timing version fails closed as legacy v1",
  );
}

function testCandidateFreeAtDoesNotDoubleBreak(): void {
  const result = checkMasterIntervalAvailability({
    masterId: "master-1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "18:00",
    extraWorkWindows: [],
    appointments: [{ ...snapshot(), status: "SCHEDULED" }],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: at("12:30"),
      endsAt: at("13:30"),
      breakAfterMinutes: 0,
    },
  });
  assert.equal(
    result.isAvailable,
    true,
    "candidate at free-at must not receive a second break",
  );
}

function testStaticWiring(): void {
  const busy = read("src/lib/schedule/appointment-busy.ts");
  const timingWrite = stripComments(
    read("src/lib/schedule/appointment-timing-write.ts"),
  );
  assert.match(busy, /client DTEND = startsAt \+ procedure duration/);
  assert.match(busy, /staff DTEND = free-at busy end/);
  assert.match(
    timingWrite,
    /desiredFreeAt\.getTime\(\)\s*!==\s*currentFreeAt\.getTime\(\)/,
    "timing comparison must use exact Date#getTime equality",
  );

  for (const file of [
    "src/services/MasterAvailabilityService.ts",
    "src/services/BookingService.ts",
    "src/services/AppointmentService.ts",
  ]) {
    const source = stripComments(read(file));
    assert.doesNotMatch(
      source,
      /toPublicBusyInterval|usePublicBusyFor(?:Appointments|ExistingAppointments)/,
    );
    assert.match(
      source,
      /getAppointmentBusyInterval/,
      `${file} must use central busy resolver`,
    );
  }

  const masterAvailability = stripComments(
    read("src/services/MasterAvailabilityService.ts"),
  );
  assert.match(masterAvailability, /getAppointmentBusyInterval\(appointment\)/);
  const booking = stripComments(read("src/services/BookingService.ts"));
  assert.match(booking, /candidateInterval:\s*\{[\s\S]*?breakAfterMinutes:\s*0/);
  assert.match(booking, /availableSlots\.includes\(input\.startTime\)/);
}

function main(): void {
  testResolverSemantics();
  testCandidateFreeAtDoesNotDoubleBreak();
  testStaticWiring();
  console.log("security-public-booking-conservative-busy-check: ok");
}

main();
