/**
 * Regression / security: публичный morning-slot cutoff (21:00 предыдущего дня).
 * Без БД: чистые unit-проверки политики + статический контракт wiring / ролей.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME,
  PUBLIC_MORNING_SLOT_BOUNDARY_TIME,
  PUBLIC_MORNING_SLOT_CUTOFF_CODE,
  PUBLIC_MORNING_SLOT_CUTOFF_MESSAGE,
  PublicMorningSlotCutoffError,
  assertPublicMorningSlotAllowed,
  evaluatePublicMorningSlotCutoff,
  filterSlotsByPublicMorningCutoff,
  getPublicMorningSlotCutoffAt,
  isPublicMorningSlotBlocked,
  isPublicMorningSlotStart,
} from "../src/lib/booking/public-morning-slot-cutoff";
import { OPERATIONAL_ADMIN_ROLES } from "../src/lib/auth/permissions";
import {
  addDaysToDateKey,
  formatStudioDateKey,
  getStudioNow,
  isValidDateKey,
} from "../src/lib/datetime/date-layer";

const ROOT = path.resolve(__dirname, "..");
const SLOT_DAY = "2026-07-21";
const PREV_DAY = "2026-07-20";
const MORNING_SLOT = "08:40";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Instant в Asia/Yekaterinburg (+05:00), независимо от TZ машины. */
function studioInstant(dateKey: string, hms: string): Date {
  const normalized = /^\d{2}:\d{2}$/.test(hms) ? `${hms}:00` : hms;
  const date = new Date(`${dateKey}T${normalized}+05:00`);
  assert.ok(
    Number.isFinite(date.getTime()),
    `invalid studio instant ${dateKey} ${hms}`,
  );
  return date;
}

function assertDecision(
  startTime: string,
  now: Date,
  expectedBlocked: boolean,
  label: string,
  slotDateKey = SLOT_DAY,
): void {
  const decision = evaluatePublicMorningSlotCutoff({
    slotDateKey,
    startTime,
    now,
  });
  assert.equal(
    decision.blocked,
    expectedBlocked,
    `${label}: blocked=${decision.blocked}, expected=${expectedBlocked}`,
  );
  assert.equal(
    isPublicMorningSlotBlocked({ slotDateKey, startTime, now }),
    expectedBlocked,
    `${label}: isPublicMorningSlotBlocked mismatch`,
  );
}

function testMorningBoundaryTimes(): void {
  assert.equal(isPublicMorningSlotStart("11:59"), true);
  assert.equal(isPublicMorningSlotStart("12:00"), false);
  assert.equal(isPublicMorningSlotStart("12:01"), false);
  assert.equal(isPublicMorningSlotStart(MORNING_SLOT), true);

  const now = studioInstant(PREV_DAY, "22:00:00");
  assertDecision("11:59", now, true, "11:59 under cutoff after 21:00");
  assertDecision("12:00", now, false, "12:00 never under morning cutoff");
  assertDecision("12:01", now, false, "12:01 never under morning cutoff");
}

function testNextDayMorningSlotTimeline(): void {
  assertDecision(
    MORNING_SLOT,
    studioInstant(PREV_DAY, "20:59:59"),
    false,
    "20:59:59 previous day — still allowed",
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(PREV_DAY, "21:00:00"),
    true,
    "21:00:00 previous day — blocked",
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(PREV_DAY, "23:59:59"),
    true,
    "23:59:59 previous day — blocked",
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(SLOT_DAY, "00:01:00"),
    true,
    "00:01 on slot day — still blocked (no reappear after midnight)",
  );
}

function testCalendarTransitions(): void {
  // End of month
  const aug1 = "2026-08-01";
  const jul31 = addDaysToDateKey(aug1, -1);
  assert.equal(jul31, "2026-07-31");
  const cutoffAug1 = getPublicMorningSlotCutoffAt(aug1);
  assert.ok(cutoffAug1);
  assert.equal(cutoffAug1!.toISOString(), studioInstant(jul31, "21:00:00").toISOString());
  assertDecision(
    MORNING_SLOT,
    studioInstant(jul31, "20:59:59"),
    false,
    "month boundary before cutoff",
    aug1,
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(jul31, "21:00:00"),
    true,
    "month boundary at cutoff",
    aug1,
  );

  // End of year
  const jan1 = "2027-01-01";
  const dec31 = addDaysToDateKey(jan1, -1);
  assert.equal(dec31, "2026-12-31");
  assertDecision(
    MORNING_SLOT,
    studioInstant(dec31, "20:59:59"),
    false,
    "year boundary before cutoff",
    jan1,
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(dec31, "21:00:00"),
    true,
    "year boundary at cutoff",
    jan1,
  );

  // Leap day Feb 29 2024 → cutoff Feb 28
  const feb29 = "2024-02-29";
  const feb28 = addDaysToDateKey(feb29, -1);
  assert.equal(feb28, "2024-02-28");
  assertDecision(
    MORNING_SLOT,
    studioInstant(feb28, "20:59:59"),
    false,
    "leap year before cutoff",
    feb29,
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(feb28, "21:00:00"),
    true,
    "leap year at cutoff",
    feb29,
  );
}

function testIndependentOfMachineTimezone(): void {
  const cutoff = getPublicMorningSlotCutoffAt(SLOT_DAY)!;
  const expected = studioInstant(PREV_DAY, "21:00:00");
  assert.equal(
    cutoff.toISOString(),
    expected.toISOString(),
    "cutoff instant must be studio +05:00, not local TZ",
  );
  // Date.getTimezoneOffset varies by machine; policy must still agree on UTC ms.
  assert.equal(cutoff.getTime(), expected.getTime());
}

function testDaySlotFiltering(): void {
  const morningOnly = ["08:40", "09:00", "10:30", "11:59"];
  const mixed = ["08:40", "11:59", "12:00", "14:00", "18:00"];
  const afterCutoff = studioInstant(PREV_DAY, "21:00:00");
  const beforeCutoff = studioInstant(PREV_DAY, "20:59:59");

  assert.deepEqual(
    filterSlotsByPublicMorningCutoff(morningOnly, SLOT_DAY, afterCutoff),
    [],
    "morning-only day disappears after cutoff",
  );
  assert.deepEqual(
    filterSlotsByPublicMorningCutoff(mixed, SLOT_DAY, afterCutoff),
    ["12:00", "14:00", "18:00"],
    "mixed day keeps noon+ slots only",
  );
  assert.deepEqual(
    filterSlotsByPublicMorningCutoff(morningOnly, SLOT_DAY, beforeCutoff),
    morningOnly,
    "before cutoff morning slots remain",
  );

  // Future day whose own previous-day cutoff has not arrived yet.
  const farDay = "2026-07-25";
  assert.deepEqual(
    filterSlotsByPublicMorningCutoff(morningOnly, farDay, afterCutoff),
    morningOnly,
    "future days before their own cutoff stay available",
  );
}

function testStaleSubmissionAssert(): void {
  const afterCutoff = studioInstant(PREV_DAY, "21:00:00");
  assert.throws(
    () =>
      assertPublicMorningSlotAllowed({
        slotDateKey: SLOT_DAY,
        startTime: MORNING_SLOT,
        now: afterCutoff,
      }),
    (error: unknown) => {
      assert.ok(error instanceof PublicMorningSlotCutoffError);
      assert.equal(error.name, PUBLIC_MORNING_SLOT_CUTOFF_CODE);
      assert.equal(error.message, PUBLIC_MORNING_SLOT_CUTOFF_MESSAGE);
      return true;
    },
    "stale submit after 21:00 must throw PUBLIC_MORNING_SLOT_CUTOFF",
  );

  assert.doesNotThrow(() =>
    assertPublicMorningSlotAllowed({
      slotDateKey: SLOT_DAY,
      startTime: MORNING_SLOT,
      now: studioInstant(PREV_DAY, "20:59:59"),
    }),
  );

  assert.doesNotThrow(() =>
    assertPublicMorningSlotAllowed({
      slotDateKey: SLOT_DAY,
      startTime: "12:00",
      now: afterCutoff,
    }),
  );
}

function testFailClosedWhenCutoffUncomputable(): void {
  const now = studioInstant(PREV_DAY, "20:59:59");

  const morningInvalidDate = evaluatePublicMorningSlotCutoff({
    slotDateKey: "not-a-valid-date",
    startTime: MORNING_SLOT,
    now,
  });
  assert.equal(morningInvalidDate.isMorningSlot, true);
  assert.equal(morningInvalidDate.cutoffAt, null);
  assert.equal(
    morningInvalidDate.blocked,
    true,
    "morning slot without computable cutoffAt must be fail-closed (blocked)",
  );
  assert.throws(
    () =>
      assertPublicMorningSlotAllowed({
        slotDateKey: "not-a-valid-date",
        startTime: MORNING_SLOT,
        now,
      }),
    (error: unknown) => error instanceof PublicMorningSlotCutoffError,
  );

  const noonInvalidDate = evaluatePublicMorningSlotCutoff({
    slotDateKey: "not-a-valid-date",
    startTime: "12:00",
    now,
  });
  assert.equal(noonInvalidDate.isMorningSlot, false);
  assert.equal(
    noonInvalidDate.blocked,
    false,
    "12:00 must not be blocked by morning cutoff even if dateKey is invalid",
  );

  // Valid morning path still allows before cutoff / blocks at cutoff.
  assertDecision(
    MORNING_SLOT,
    studioInstant(PREV_DAY, "20:59:59"),
    false,
    "valid date 20:59:59 still allows",
  );
  assertDecision(
    MORNING_SLOT,
    studioInstant(PREV_DAY, "21:00:00"),
    true,
    "valid date 21:00:00 still blocks",
  );
}

function testCalendarInvalidDateKeysFailClosed(): void {
  const nowBeforeAnyCutoff = studioInstant(PREV_DAY, "10:00:00");
  const invalidKeys = [
    "2026-13-01",
    "2026-02-30",
    "2025-02-29",
    "2026-04-31",
  ];

  for (const dateKey of invalidKeys) {
    assert.equal(
      isValidDateKey(dateKey),
      false,
      `${dateKey} must fail calendar-strict isValidDateKey`,
    );

    const cutoffAt = getPublicMorningSlotCutoffAt(dateKey);
    assert.equal(cutoffAt, null, `${dateKey}: cutoffAt must be null`);

    // Must not silently become today's cutoff (addDaysToDateKey today-fallback).
    const todayCutoff = getPublicMorningSlotCutoffAt(
      formatStudioDateKey(getStudioNow()),
    );
    assert.notEqual(
      cutoffAt?.getTime(),
      todayCutoff?.getTime() ?? -1,
      `${dateKey}: must not equal today-fallback cutoff instant`,
    );

    const morning = evaluatePublicMorningSlotCutoff({
      slotDateKey: dateKey,
      startTime: MORNING_SLOT,
      now: nowBeforeAnyCutoff,
    });
    assert.equal(morning.isMorningSlot, true, `${dateKey} 08:40 is morning`);
    assert.equal(morning.cutoffAt, null, `${dateKey} cutoffAt null`);
    assert.equal(
      morning.blocked,
      true,
      `${dateKey} morning must be fail-closed even before 21:00`,
    );

    const noon = evaluatePublicMorningSlotCutoff({
      slotDateKey: dateKey,
      startTime: "12:00",
      now: nowBeforeAnyCutoff,
    });
    assert.equal(noon.isMorningSlot, false);
    assert.equal(
      noon.blocked,
      false,
      `${dateKey} 12:00 must not be blocked by morning cutoff`,
    );
  }

  for (const dateKey of ["2026-02-28", "2028-02-29", "2026-12-31"]) {
    assert.equal(isValidDateKey(dateKey), true, `${dateKey} remains valid`);
    assert.ok(
      getPublicMorningSlotCutoffAt(dateKey),
      `${dateKey} must produce a real cutoffAt`,
    );
  }

  // Explicit M2 cases called out in the finding.
  const m2 = evaluatePublicMorningSlotCutoff({
    slotDateKey: "2026-13-01",
    startTime: "08:40",
    now: nowBeforeAnyCutoff,
  });
  assert.equal(m2.cutoffAt, null);
  assert.equal(m2.blocked, true);
  assert.equal(m2.isMorningSlot, true);
}

function testPolicyDoesNotUseAddDaysToDateKeyFallback(): void {
  const policy = stripComments(
    read("src/lib/booking/public-morning-slot-cutoff.ts"),
  );
  const dateLayer = stripComments(read("src/lib/datetime/date-layer.ts"));

  assert.doesNotMatch(
    policy,
    /\baddDaysToDateKey\b/,
    "cutoff policy must not call addDaysToDateKey (today-fallback risk)",
  );
  assert.match(policy, /\baddDaysSafe\b/);
  assert.match(policy, /\bparseStudioDateKey\b/);
  assert.match(policy, /\bformatStudioDateKey\b/);

  assert.match(
    dateLayer,
    /function isValidDateKey\([\s\S]*?getDaysInMonthCount/,
    "isValidDateKey must enforce real calendar days",
  );

  // Mutation: reintroducing addDaysToDateKey into policy must fail the contract.
  const mutatedPolicy = `${policy}\nconst prev = addDaysToDateKey(slotDateKey, -1);\n`;
  assert.throws(
    () => {
      assert.doesNotMatch(
        mutatedPolicy,
        /\baddDaysToDateKey\b/,
        "cutoff policy must not call addDaysToDateKey (today-fallback risk)",
      );
    },
    (error: unknown) => error instanceof assert.AssertionError,
    "reintroducing addDaysToDateKey must fail security-check",
  );
}

function testPublicRoutesRejectInvalidCalendarDates(): void {
  const createRoute = stripComments(
    read("src/app/api/booking/create/route.ts"),
  );
  const slotsRoute = stripComments(read("src/app/api/booking/slots/route.ts"));

  const dateCheckIdx = createRoute.indexOf("isValidDateKey(body.date)");
  const invalidDateIdx = createRoute.indexOf('"INVALID_DATE"');
  const createCallIdx = createRoute.indexOf("createOnlineBooking({");
  assert.ok(dateCheckIdx >= 0, "create route must validate dateKey");
  assert.ok(invalidDateIdx > dateCheckIdx, "INVALID_DATE follows date check");
  assert.ok(
    createCallIdx > invalidDateIdx,
    "INVALID_DATE must be returned before createOnlineBooking",
  );
  assert.match(
    createRoute,
    /isValidDateKey\(body\.date\)[\s\S]*?code:\s*"INVALID_DATE"[\s\S]*?createOnlineBooking\(/,
  );

  assert.match(
    slotsRoute,
    /isValidDateKey\(dateKey\)/,
    "slots route must reject calendar-invalid dateKey",
  );

  // Runtime: calendar-invalid keys are rejected by shared validator used by routes.
  for (const dateKey of [
    "2026-13-01",
    "2026-02-30",
    "2025-02-29",
    "2026-04-31",
  ]) {
    assert.equal(isValidDateKey(dateKey), false);
  }
}

function extractErrorHandlerBranch(
  routeSource: string,
  errorClassName: string,
): string {
  const marker = `if (error instanceof ${errorClassName})`;
  const start = routeSource.indexOf(marker);
  assert.ok(start >= 0, `missing handler for ${errorClassName}`);

  const afterMarker = start + marker.length;
  const rest = routeSource.slice(afterMarker);
  const nextSibling = /\n\s*if\s*\(\s*error\s+instanceof\b/.exec(rest);
  const end = nextSibling
    ? afterMarker + (nextSibling.index ?? 0)
    : routeSource.length;
  return routeSource.slice(start, end);
}

function assertCutoffHttpHandlerContract(handler: string): void {
  assert.match(
    handler,
    /instanceof PublicMorningSlotCutoffError/,
    "cutoff handler must match PublicMorningSlotCutoffError",
  );
  assert.match(
    handler,
    /errorResponse\(\s*error\.message\s*,\s*409\s*,/,
    "cutoff handler must return HTTP 409 via errorResponse",
  );
  assert.match(
    handler,
    /code:\s*error\.name/,
    "cutoff handler code must come from error.name (PUBLIC_MORNING_SLOT_CUTOFF)",
  );
  assert.doesNotMatch(
    handler,
    /AppointmentConflictError/,
    "cutoff handler fragment must not include AppointmentConflictError",
  );
  assert.doesNotMatch(
    handler,
    /errorResponse\(\s*error\.message\s*,\s*500\s*,/,
    "cutoff handler must not return 500",
  );
}

function testCreateFlowOrderingAndHttpMapping(): void {
  const booking = stripComments(read("src/services/BookingService.ts"));
  const createRoute = stripComments(read("src/app/api/booking/create/route.ts"));
  const policy = stripComments(
    read("src/lib/booking/public-morning-slot-cutoff.ts"),
  );

  const createFnStart = booking.indexOf(
    "export async function createOnlineBooking",
  );
  assert.ok(createFnStart >= 0);
  const createFnNext = booking.indexOf("\nexport ", createFnStart + 1);
  const createFn = booking.slice(
    createFnStart,
    createFnNext >= 0 ? createFnNext : undefined,
  );

  const consentIdx = createFn.indexOf("isClientConsentGiven");
  const fieldsIdx = createFn.indexOf("validateClientContactFields");
  const legalIdx = createFn.indexOf("assertRequiredLegalDocumentsPublished");
  const bookableIdx = createFn.indexOf("await assertOnlineBookable");
  const nowIdx = createFn.indexOf("const now = options.now ?? getStudioNow()");
  const cutoffIdx = createFn.indexOf("assertPublicMorningSlotAllowed");
  const slotsIdx = createFn.indexOf("getAvailableTimeSlots");
  const clientIdx = createFn.indexOf("resolveClientForLead");
  const appointmentIdx = createFn.indexOf("createOnlineAppointment");

  assert.ok(consentIdx >= 0 && fieldsIdx > consentIdx);
  assert.ok(legalIdx > fieldsIdx, "legal validation after field checks");
  assert.ok(bookableIdx > legalIdx, "bookable after legal");
  assert.ok(
    nowIdx > bookableIdx,
    "single now must be fixed after read-only validation, before cutoff",
  );
  assert.ok(cutoffIdx > nowIdx, "cutoff assert immediately after now");
  assert.ok(slotsIdx > cutoffIdx, "getAvailableTimeSlots after cutoff");
  assert.ok(clientIdx > slotsIdx, "resolveClientForLead after cutoff/slots");
  assert.ok(
    appointmentIdx > clientIdx,
    "createOnlineAppointment after client/lead",
  );

  assert.equal(
    (createFn.match(/const now = options\.now \?\? getStudioNow\(\)/g) ?? [])
      .length,
    1,
    "exactly one now fixation in createOnlineBooking",
  );
  assert.equal(
    (createFn.match(/getStudioNow\(\)/g) ?? []).length,
    1,
    "no second getStudioNow() in createOnlineBooking",
  );
  assert.match(
    createFn,
    /assertPublicMorningSlotAllowed\(\{[\s\S]*?\bnow\b/,
    "cutoff uses the fixed now",
  );
  assert.match(
    createFn,
    /getAvailableTimeSlots\([\s\S]*\{\s*now\s*\}/,
    "getAvailableTimeSlots receives the same now object",
  );

  assert.match(
    policy,
    /this\.name\s*=\s*PUBLIC_MORNING_SLOT_CUTOFF_CODE/,
    "error.name is the stable PUBLIC_MORNING_SLOT_CUTOFF code",
  );

  const cutoffHandler = extractErrorHandlerBranch(
    createRoute,
    "PublicMorningSlotCutoffError",
  );
  assertCutoffHttpHandlerContract(cutoffHandler);

  // Mutation: 409 → 500 must fail the cutoff HTTP contract.
  const mutated500 = cutoffHandler.replace(
    /errorResponse\(\s*error\.message\s*,\s*409\s*,/,
    "errorResponse(error.message, 500,",
  );
  assert.throws(
    () => assertCutoffHttpHandlerContract(mutated500),
    (error: unknown) => error instanceof assert.AssertionError,
    "replacing cutoff 409 with 500 must fail security-check",
  );

  // Mutation: remove cutoff handler — must fail.
  const withoutCutoffHandler = createRoute.replace(cutoffHandler, "\n");
  assert.throws(
    () =>
      extractErrorHandlerBranch(
        withoutCutoffHandler,
        "PublicMorningSlotCutoffError",
      ),
    (error: unknown) => error instanceof assert.AssertionError,
    "removing cutoff handler must fail security-check",
  );

  // AppointmentConflictError 409 branch must NOT satisfy cutoff contract.
  const conflictHandler = extractErrorHandlerBranch(
    createRoute,
    "AppointmentConflictError",
  );
  assert.match(conflictHandler, /errorResponse\(\s*error\.message\s*,\s*409\s*,/);
  assert.doesNotMatch(
    conflictHandler,
    /PublicMorningSlotCutoffError/,
    "AppointmentConflictError branch is not the cutoff handler",
  );
  assert.throws(
    () => assertCutoffHttpHandlerContract(conflictHandler),
    (error: unknown) => error instanceof assert.AssertionError,
    "AppointmentConflictError 409 must not satisfy cutoff assertion",
  );

  assert.match(
    createRoute,
    /createOnlineBooking/,
    "create route uses BookingService.createOnlineBooking",
  );
}

function testSlotsAndAvailableDaysWiring(): void {
  const slotsRoute = stripComments(read("src/app/api/booking/slots/route.ts"));
  const daysRoute = stripComments(
    read("src/app/api/booking/available-days/route.ts"),
  );
  const booking = stripComments(read("src/services/BookingService.ts"));

  assert.match(slotsRoute, /const now = getStudioNow\(\)/);
  assert.match(slotsRoute, /formatStudioDateKey\(now\)/);
  assert.match(slotsRoute, /\{\s*now\s*\}/);
  assert.match(slotsRoute, /getAvailableTimeSlots/);

  assert.match(daysRoute, /const now = getStudioNow\(\)/);
  assert.match(daysRoute, /getAvailableDaysInMonth/);
  assert.match(daysRoute, /\{\s*now\s*\}/);

  assert.match(
    booking,
    /isPublicMorningSlotBlocked\(/,
    "getAvailableTimeSlots must apply morning cutoff filter",
  );
  assert.match(
    booking,
    /const slots = await getAvailableTimeSlots[\s\S]*?now:\s*options\.now/,
    "available-days builds from already-filtered slots with shared now",
  );
  assert.match(
    booking,
    /now\?: Date/,
    "PublicSlotCalculationOptions exposes now DI",
  );
}

function testInternalPathsUnaffected(): void {
  const appointmentService = stripComments(
    read("src/services/AppointmentService.ts"),
  );
  const appointmentsRoute = stripComments(
    read("src/app/api/appointments/route.ts"),
  );
  const availability = stripComments(
    read("src/services/MasterAvailabilityService.ts"),
  );

  assert.doesNotMatch(
    appointmentService,
    /public-morning-slot-cutoff|PublicMorningSlotCutoff|assertPublicMorningSlotAllowed/,
    "AppointmentService must not import morning cutoff",
  );
  assert.doesNotMatch(
    appointmentsRoute,
    /public-morning-slot-cutoff|PublicMorningSlotCutoff|assertPublicMorningSlotAllowed/,
    "internal /api/appointments must not apply morning cutoff",
  );
  assert.doesNotMatch(
    availability,
    /public-morning-slot-cutoff|PublicMorningSlotCutoff/,
    "MasterAvailabilityService must not apply morning cutoff",
  );

  assert.match(
    appointmentsRoute,
    /createAppointment/,
    "OWNER/MANAGER path remains createAppointment",
  );
  assert.match(
    appointmentsRoute,
    /WRITE_SCHEDULE_ROLES/,
    "internal create gated by WRITE_SCHEDULE_ROLES (OWNER+MANAGER)",
  );
}

function testMasterRemainsReadOnly(): void {
  const apiAccess = stripComments(read("src/lib/auth/api-access.ts"));
  assert.match(
    apiAccess,
    /WRITE_SCHEDULE_ROLES[\s\S]*?OPERATIONAL_ADMIN_ROLES/,
  );
  assert.ok(
    OPERATIONAL_ADMIN_ROLES.includes("OWNER") &&
      OPERATIONAL_ADMIN_ROLES.includes("MANAGER") &&
      !OPERATIONAL_ADMIN_ROLES.includes("MASTER"),
    "MASTER must not be in OPERATIONAL_ADMIN_ROLES / WRITE_SCHEDULE_ROLES",
  );

  const appointmentsRoute = stripComments(
    read("src/app/api/appointments/route.ts"),
  );
  assert.doesNotMatch(
    appointmentsRoute,
    /"MASTER"/,
    "appointments POST must not grant MASTER write",
  );
}

function testConstantsNotDuplicatedInProduction(): void {
  const policyRel = "src/lib/booking/public-morning-slot-cutoff.ts";
  const policy = read(policyRel);

  assert.match(
    policy,
    new RegExp(
      `PUBLIC_MORNING_SLOT_BOUNDARY_TIME\\s*=\\s*"${PUBLIC_MORNING_SLOT_BOUNDARY_TIME}"`,
    ),
  );
  assert.match(
    policy,
    new RegExp(
      `PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME\\s*=\\s*"${PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME}"`,
    ),
  );

  const productionFiles = [
    "src/services/BookingService.ts",
    "src/app/api/booking/slots/route.ts",
    "src/app/api/booking/available-days/route.ts",
    "src/app/api/booking/create/route.ts",
    "src/lib/booking/public-booking-errors.ts",
  ];

  for (const rel of productionFiles) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /PUBLIC_MORNING_SLOT_BOUNDARY_TIME\s*=/,
      `${rel} must not redefine boundary constant`,
    );
    assert.doesNotMatch(
      src,
      /PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME\s*=/,
      `${rel} must not redefine cutoff constant`,
    );
  }

  // Literal morning/cutoff pair must live only in the policy module among booking prod files.
  const bookingService = read("src/services/BookingService.ts");
  assert.doesNotMatch(
    bookingService,
    /"21:00"[\s\S]{0,80}"12:00"|"12:00"[\s\S]{0,80}"21:00"/,
    "BookingService must not hardcode 12:00/21:00 cutoff pair",
  );
}

function testRegressionMarkersStillPresent(): void {
  const booking = stripComments(read("src/services/BookingService.ts"));

  // Past-time filter for studioToday still present (now via injected now).
  assert.match(
    booking,
    /dateKey === studioToday \? formatStudioTimeInput\(now\) : "00:00"/,
  );

  // Slot chains still applied after raw slot collection (cutoff is in the loop before chains).
  assert.match(booking, /filterSlotsByReachableChains/);
  assert.match(
    booking,
    /isPublicMorningSlotBlocked[\s\S]*?filterSlotsByReachableChains|isPublicMorningSlotBlocked[\s\S]*?rawSlots/,
  );

  // Extra work windows still loaded with online flag only.
  assert.match(
    booking,
    /extraWorkWindow\.findMany\(\{[\s\S]*?isOnlineBookingEnabled:\s*true/,
  );

  // Kill-switch unchanged.
  assert.match(booking, /assertStudioOnlineBookingEnabled/);
  assert.match(booking, /isOnlineBookingEnabled/);
}

function main(): void {
  testMorningBoundaryTimes();
  testNextDayMorningSlotTimeline();
  testCalendarTransitions();
  testIndependentOfMachineTimezone();
  testDaySlotFiltering();
  testFailClosedWhenCutoffUncomputable();
  testCalendarInvalidDateKeysFailClosed();
  testPolicyDoesNotUseAddDaysToDateKeyFallback();
  testPublicRoutesRejectInvalidCalendarDates();
  testStaleSubmissionAssert();
  testCreateFlowOrderingAndHttpMapping();
  testSlotsAndAvailableDaysWiring();
  testInternalPathsUnaffected();
  testMasterRemainsReadOnly();
  testConstantsNotDuplicatedInProduction();
  testRegressionMarkersStillPresent();

  console.log("security-public-morning-slot-cutoff-check: OK");
}

main();
