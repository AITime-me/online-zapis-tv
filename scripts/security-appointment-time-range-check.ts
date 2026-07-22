/**
 * Регрессия: timeLabel показывает фактический startsAt–endsAt без breakAfterMinutes.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addMinutesSafe, parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { buildScheduleAppointmentDisplay } from "../src/lib/schedule/appointment-display";

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

function iso(time: string): string {
  const value = parseStudioDateKey(DATE_KEY, time);
  assert.ok(value);
  return value.toISOString();
}

function testStandardInterval(): void {
  const display = buildScheduleAppointmentDisplay({
    startsAt: iso("14:00"),
    endsAt: iso("15:00"),
    serviceName: "Массаж",
    clientName: "Анна",
  });
  assert.equal(display.timeLabel, "14:00–15:00");
}

function testShortenedManualInterval(): void {
  const display = buildScheduleAppointmentDisplay({
    startsAt: iso("14:00"),
    endsAt: iso("14:40"),
    serviceName: "Массаж",
    clientName: "Анна",
  });
  assert.equal(display.timeLabel, "14:00–14:40");
}

function testExtendedManualInterval(): void {
  const display = buildScheduleAppointmentDisplay({
    startsAt: iso("14:00"),
    endsAt: iso("15:30"),
    serviceName: "Массаж",
    clientName: "Анна",
  });
  assert.equal(display.timeLabel, "14:00–15:30");
}

function testBreakNotAddedToLabel(): void {
  const startsAt = parseStudioDateKey(DATE_KEY, "14:00");
  const endsAt = parseStudioDateKey(DATE_KEY, "15:00");
  assert.ok(startsAt && endsAt);
  const busyEnd = addMinutesSafe(endsAt, 15);
  assert.ok(busyEnd);

  const display = buildScheduleAppointmentDisplay({
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    serviceName: "Массаж",
    clientName: "Анна",
  });

  assert.equal(display.timeLabel, "14:00–15:00");
  assert.notEqual(
    display.timeLabel,
    `14:00–${busyEnd.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Yekaterinburg" })}`,
  );
  assert.doesNotMatch(display.timeLabel, /15:15/);
}

function testOverlappingAppointmentsHaveOwnRanges(): void {
  const first = buildScheduleAppointmentDisplay({
    startsAt: iso("14:00"),
    endsAt: iso("15:00"),
    serviceName: "A",
    clientName: "A",
  });
  const second = buildScheduleAppointmentDisplay({
    startsAt: iso("14:30"),
    endsAt: iso("15:30"),
    serviceName: "B",
    clientName: "B",
  });
  assert.equal(first.timeLabel, "14:00–15:00");
  assert.equal(second.timeLabel, "14:30–15:30");
  assert.notEqual(first.timeLabel, second.timeLabel);
}

function testHelperUsesFormatStudioTimeRange(): void {
  const src = stripComments(read("src/lib/schedule/appointment-display.ts"));
  assert.match(src, /formatStudioTimeRange\(appointment\.startsAt,\s*appointment\.endsAt\)/);
  assert.doesNotMatch(
    src,
    /timeLabel:\s*formatStudioTime\(appointment\.startsAt\)/,
  );
  assert.doesNotMatch(src, /breakAfterMinutes/);
}

function testPublicBookingUntouched(): void {
  const manage = stripComments(read("src/services/BookingManageService.ts"));
  assert.match(manage, /timeLabel:\s*formatStudioTimeInput\(appointment\.startsAt\)/);
  assert.doesNotMatch(
    manage,
    /buildScheduleAppointmentDisplay/,
  );
}

function main(): void {
  testStandardInterval();
  testShortenedManualInterval();
  testExtendedManualInterval();
  testBreakNotAddedToLabel();
  testOverlappingAppointmentsHaveOwnRanges();
  testHelperUsesFormatStudioTimeRange();
  testPublicBookingUntouched();
  console.log("security-appointment-time-range-check: OK");
}

main();
