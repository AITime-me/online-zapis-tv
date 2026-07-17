process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LAST_BOOKING_START,
  DEFAULT_WEEKDAY_WORK_START,
  DEFAULT_WEEKEND_WORK_START,
  doesAppointmentFitResolvedHours,
  isAllowedBookingStart,
  resolveMasterWorkHours,
  resolvePublicOnlineBookingHours,
} from "../src/lib/schedule/master-work-hours";
import { checkMasterIntervalAvailability } from "../src/services/MasterAvailabilityService";
import {
  getWeekdayIndex,
  parseStudioDateKey,
} from "../src/lib/datetime/date-layer";

const MONDAY = "2026-07-20";
const SATURDAY = "2026-07-18";
const SUNDAY = "2026-07-19";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function defaultMaster() {
  return {
    workStart: "00:00",
    workEnd: "23:59",
    usesDefaultWorkHours: true,
  };
}

function customMaster(workStart: string, workEnd: string) {
  return {
    workStart,
    workEnd,
    usesDefaultWorkHours: false,
  };
}

function testWeekdayIndexes(): void {
  assert.equal(getWeekdayIndex(MONDAY), 1, "2026-07-20 должен быть понедельником");
  assert.equal(getWeekdayIndex(SATURDAY), 6, "2026-07-18 должен быть субботой");
  assert.equal(getWeekdayIndex(SUNDAY), 0, "2026-07-19 должен быть воскресеньем");
}

function testOfficialDefaultsResolveCorrectly(): void {
  const monday = resolveMasterWorkHours(defaultMaster(), MONDAY);
  assert.equal(monday.workStart, DEFAULT_WEEKDAY_WORK_START);
  assert.equal(monday.workEnd, DEFAULT_LAST_BOOKING_START);
  assert.equal(monday.constrainAppointmentEnd, false);

  const saturday = resolveMasterWorkHours(defaultMaster(), SATURDAY);
  assert.equal(saturday.workStart, DEFAULT_WEEKEND_WORK_START);
  assert.equal(saturday.workEnd, DEFAULT_LAST_BOOKING_START);
  assert.equal(saturday.constrainAppointmentEnd, false);

  const sunday = resolveMasterWorkHours(defaultMaster(), SUNDAY);
  assert.equal(sunday.workStart, DEFAULT_WEEKEND_WORK_START);
  assert.equal(sunday.workEnd, DEFAULT_LAST_BOOKING_START);
  assert.equal(sunday.constrainAppointmentEnd, false);
}

function testMondayOfficialStarts(): void {
  const hours = resolveMasterWorkHours(defaultMaster(), MONDAY);

  assert.equal(isAllowedBookingStart("09:00", hours), true);
  assert.equal(isAllowedBookingStart("18:00", hours), true);
  assert.equal(isAllowedBookingStart("18:30", hours), false);
  assert.equal(isAllowedBookingStart("08:30", hours), false);

  assert.equal(
    doesAppointmentFitResolvedHours("18:00", "19:30", hours),
    true,
    "при официальных часах процедура может заканчиваться после 18:00",
  );
  assert.equal(doesAppointmentFitResolvedHours("18:30", "19:00", hours), false);
}

function testSaturdayOfficialStarts(): void {
  const hours = resolveMasterWorkHours(defaultMaster(), SATURDAY);

  assert.equal(isAllowedBookingStart("10:00", hours), true);
  assert.equal(isAllowedBookingStart("18:00", hours), true);
  assert.equal(isAllowedBookingStart("09:30", hours), false);
  assert.equal(isAllowedBookingStart("18:30", hours), false);
}

function testSundayUsesWeekendRange(): void {
  const hours = resolveMasterWorkHours(defaultMaster(), SUNDAY);
  assert.equal(isAllowedBookingStart("10:00", hours), true);
  assert.equal(isAllowedBookingStart("09:00", hours), false);
  assert.equal(isAllowedBookingStart("18:00", hours), true);
}

function testCustomHoursKeepEndConstraint(): void {
  const internal = resolveMasterWorkHours(customMaster("11:00", "16:00"), MONDAY);
  assert.equal(internal.constrainAppointmentEnd, true);
  assert.equal(isAllowedBookingStart("11:00", internal), true);
  assert.equal(isAllowedBookingStart("16:00", internal), false);

  const publicHours = resolvePublicOnlineBookingHours(
    customMaster("11:00", "16:00"),
    MONDAY,
  );
  assert.equal(publicHours.workEnd, "16:00");
  assert.equal(isAllowedBookingStart("18:00", publicHours), false);
  assert.equal(doesAppointmentFitResolvedHours("15:00", "16:00", publicHours), true);
  assert.equal(doesAppointmentFitResolvedHours("15:30", "16:30", publicHours), false);
}

function testIndividualScheduleUntil20CapsPublicLastStart(): void {
  const internal = resolveMasterWorkHours(customMaster("09:00", "20:00"), MONDAY);
  assert.equal(internal.workEnd, "20:00");
  assert.equal(isAllowedBookingStart("18:30", internal), true);

  const publicHours = resolvePublicOnlineBookingHours(
    customMaster("09:00", "20:00"),
    MONDAY,
  );
  assert.equal(publicHours.workEnd, DEFAULT_LAST_BOOKING_START);
  assert.equal(publicHours.constrainAppointmentEnd, false);
  assert.equal(isAllowedBookingStart("18:00", publicHours), true);
  assert.equal(isAllowedBookingStart("18:30", publicHours), false);

  const dateKey = MONDAY;
  const at1800 = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey,
    standardWorkStart: publicHours.workStart,
    standardWorkEnd: publicHours.workEnd,
    constrainAppointmentEnd: publicHours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(dateKey, "18:00")!,
      endsAt: parseStudioDateKey(dateKey, "19:00")!,
    },
  });
  assert.equal(at1800.isAvailable, true);

  const at1830 = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey,
    standardWorkStart: publicHours.workStart,
    standardWorkEnd: publicHours.workEnd,
    constrainAppointmentEnd: publicHours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(dateKey, "18:30")!,
      endsAt: parseStudioDateKey(dateKey, "19:00")!,
    },
  });
  assert.equal(at1830.isAvailable, false);
  assert.ok(at1830.conflicts.some((c) => c.type === "outside_work_hours"));
}

function testIndividualScheduleUntil17DoesNotExpandTo18(): void {
  const publicHours = resolvePublicOnlineBookingHours(
    customMaster("09:00", "17:00"),
    MONDAY,
  );
  assert.equal(publicHours.workEnd, "17:00");
  assert.equal(publicHours.constrainAppointmentEnd, true);
  assert.equal(isAllowedBookingStart("16:30", publicHours), true);
  assert.equal(isAllowedBookingStart("17:00", publicHours), false);
  assert.equal(isAllowedBookingStart("18:00", publicHours), false);
}

function testAdminManualPathIgnoresPublicLastStartCap(): void {
  const appointmentService = readSource("src/services/AppointmentService.ts");
  assert.match(
    appointmentService,
    /resolveMasterWorkHours\(context\.master/,
    "админский conflict-check использует resolveMasterWorkHours, не public cap",
  );
  assert.doesNotMatch(
    appointmentService,
    /resolvePublicOnlineBookingHours/,
    "AppointmentService не должен применять публичный cap",
  );
  assert.doesNotMatch(
    appointmentService,
    /outside_work_hours[\s\S]*throw/,
    "outside_work_hours не блокирует админское создание",
  );

  const internal = resolveMasterWorkHours(customMaster("09:00", "20:00"), MONDAY);
  const adminLate = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: MONDAY,
    standardWorkStart: internal.workStart,
    standardWorkEnd: internal.workEnd,
    constrainAppointmentEnd: internal.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(MONDAY, "19:00")!,
      endsAt: parseStudioDateKey(MONDAY, "19:30")!,
    },
  });
  assert.equal(
    adminLate.isAvailable,
    true,
    "внутренний путь: 19:00 укладывается в индивидуальный график до 20:00",
  );
}

function testExistingLateAppointmentsNotFilteredFromSchedule(): void {
  const scheduleDay = readSource("src/services/ScheduleDayService.ts");
  const scheduleMonth = readSource("src/services/ScheduleMonthService.ts");
  assert.doesNotMatch(
    scheduleDay,
    /resolvePublicOnlineBookingHours|resolveMasterWorkHours|outside_work_hours/,
    "отображение дня не фильтрует записи по публичным часам",
  );
  assert.doesNotMatch(
    scheduleMonth,
    /resolvePublicOnlineBookingHours|outside_work_hours/,
    "отображение месяца не фильтрует записи по публичным часам",
  );
}

function testAvailabilityHonorsLastStartAndDayOff(): void {
  const hours = resolveMasterWorkHours(defaultMaster(), MONDAY);
  const dateKey = MONDAY;

  const lateStart = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(dateKey, "18:00")!,
      endsAt: parseStudioDateKey(dateKey, "19:00")!,
      breakAfterMinutes: 15,
    },
  });
  assert.equal(lateStart.isAvailable, true);
  assert.equal(lateStart.conflicts.length, 0);

  const tooLate = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(dateKey, "18:30")!,
      endsAt: parseStudioDateKey(dateKey, "19:00")!,
    },
  });
  assert.equal(tooLate.isAvailable, false);
  assert.ok(tooLate.conflicts.some((c) => c.type === "outside_work_hours"));

  const dayOff = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [
      {
        startsAt: parseStudioDateKey(dateKey, "00:00")!,
        endsAt: parseStudioDateKey(dateKey, "23:59")!,
        isFullDay: true,
      },
    ],
    candidateInterval: {
      startsAt: parseStudioDateKey(dateKey, "10:00")!,
      endsAt: parseStudioDateKey(dateKey, "10:30")!,
    },
  });
  assert.equal(dayOff.isAvailable, false);
  assert.ok(dayOff.conflicts.some((c) => c.type === "full_day_block"));
}

function testBookingLoopUsesInclusiveLastStart(): void {
  const bookingSource = readSource("src/services/BookingService.ts");
  assert.match(
    bookingSource,
    /resolvePublicOnlineBookingHours\(master, dateKey\)/,
    "публичные слоты используют resolvePublicOnlineBookingHours",
  );
  assert.match(
    bookingSource,
    /constrainAppointmentEnd[\s\S]*compareTimeStrings\(current, rangeEnd\) <= 0/,
  );
  assert.match(
    bookingSource,
    /constrainAppointmentEnd:\s*context\.workHours\.constrainAppointmentEnd/,
  );

  const hoursSource = readSource("src/lib/schedule/master-work-hours.ts");
  assert.match(hoursSource, /DEFAULT_LAST_BOOKING_START\s*=\s*"18:00"/);
  assert.doesNotMatch(
    hoursSource,
    /DEFAULT_WEEKDAY_WORK_END\s*=\s*"20:00"/,
  );
  assert.doesNotMatch(
    hoursSource,
    /DEFAULT_WEEKEND_WORK_END\s*=\s*"20:00"/,
  );

  const masterForm = readSource("src/components/admin/master-form.tsx");
  assert.match(masterForm, /09:00–18:00/);
  assert.doesNotMatch(masterForm, /09:00–20:00/);
}

function main(): void {
  testWeekdayIndexes();
  testOfficialDefaultsResolveCorrectly();
  testMondayOfficialStarts();
  testSaturdayOfficialStarts();
  testSundayUsesWeekendRange();
  testCustomHoursKeepEndConstraint();
  testIndividualScheduleUntil20CapsPublicLastStart();
  testIndividualScheduleUntil17DoesNotExpandTo18();
  testAdminManualPathIgnoresPublicLastStartCap();
  testExistingLateAppointmentsNotFilteredFromSchedule();
  testAvailabilityHonorsLastStartAndDayOff();
  testBookingLoopUsesInclusiveLastStart();

  console.log("security-official-work-hours-check: OK");
}

main();
