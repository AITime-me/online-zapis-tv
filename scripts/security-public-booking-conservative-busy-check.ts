/**
 * Регрессия: публичная занятость Appointment — conservative busy
 * (max(actual endsAt, startsAt + standardDuration) + break), без утечки
 * ручного сокращения в онлайн-слоты.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AppointmentStatus } from "@prisma/client";
import {
  filterSlotsByReachableChains,
  firstGridStartOnOrAfter,
  minutesToTime,
  parseTimeToMinutes,
  type SlotChainBlockingInterval,
  type SlotChainTiming,
  type SlotChainWorkWindow,
} from "../src/lib/booking/online-slot-chains";
import {
  addMinutesSafe,
  formatStudioTimeInput,
  parseStudioDateKey,
} from "../src/lib/datetime/date-layer";
import { buildScheduleAppointmentDisplay } from "../src/lib/schedule/appointment-display";
import { resolveAppointmentWriteConflict } from "../src/lib/schedule/appointment-write-conflicts";
import { isBlockingAppointmentStatus } from "../src/lib/schedule/non-blocking-appointment-statuses";
import {
  checkMasterIntervalAvailability,
  toBusyInterval,
  toPublicBusyInterval,
} from "../src/services/MasterAvailabilityService";

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

function timeOf(date: Date): string {
  return formatStudioTimeInput(date);
}

function assertBusyEndsAt(
  busy: { endsAt: Date },
  expectedTime: string,
  label: string,
): void {
  assert.equal(timeOf(busy.endsAt), expectedTime, label);
}

function shortenedManualAppointment(overrides: {
  breakAfterMinutes?: number | null;
  standardDurationMinutes?: number | null;
  standardBreakAfterMinutes?: number | null;
  status?: AppointmentStatus;
} = {}) {
  return {
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes:
      overrides.breakAfterMinutes === undefined ? 30 : overrides.breakAfterMinutes,
    standardDurationMinutes:
      overrides.standardDurationMinutes === undefined
        ? 120
        : overrides.standardDurationMinutes,
    standardBreakAfterMinutes:
      overrides.standardBreakAfterMinutes === undefined
        ? 30
        : overrides.standardBreakAfterMinutes,
    status: overrides.status ?? ("SCHEDULED" as const),
  };
}

function candidateAt(
  start: string,
  durationMinutes: number,
  breakAfterMinutes: number,
) {
  const startsAt = at(start);
  const endsAt = addMinutesSafe(startsAt, durationMinutes)!;
  return { startsAt, endsAt, breakAfterMinutes };
}

function publicAvailabilityForCandidate(
  appointments: ReturnType<typeof shortenedManualAppointment>[],
  candidate: ReturnType<typeof candidateAt>,
  extras: {
    extraWorkWindows?: Array<{ startsAt: Date; endsAt: Date }>;
    scheduleBlocks?: Array<{
      startsAt: Date;
      endsAt: Date;
      isFullDay?: boolean;
    }>;
  } = {},
) {
  return checkMasterIntervalAvailability({
    masterId: "master-1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "18:00",
    constrainAppointmentEnd: false,
    extraWorkWindows: extras.extraWorkWindows ?? [
      { startsAt: at("08:40"), endsAt: at("09:00") },
    ],
    appointments,
    scheduleBlocks: extras.scheduleBlocks ?? [],
    candidateInterval: candidate,
    usePublicBusyForAppointments: true,
  });
}

function actualAvailabilityForCandidate(
  appointments: ReturnType<typeof shortenedManualAppointment>[],
  candidate: ReturnType<typeof candidateAt>,
) {
  return checkMasterIntervalAvailability({
    masterId: "master-1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "18:00",
    constrainAppointmentEnd: false,
    extraWorkWindows: [],
    appointments,
    scheduleBlocks: [],
    candidateInterval: candidate,
    usePublicBusyForAppointments: false,
  });
}

function publicBusyBlockingInterval(
  appointment: ReturnType<typeof shortenedManualAppointment>,
): SlotChainBlockingInterval {
  const busy = toPublicBusyInterval(appointment);
  return {
    startMinutes: parseTimeToMinutes(timeOf(busy.startsAt)),
    endMinutes: parseTimeToMinutes(timeOf(busy.endsAt)),
  };
}

function generateRawGrid(
  origin: string,
  lastStart: string,
  step: number,
): string[] {
  const slots: string[] = [];
  for (
    let current = parseTimeToMinutes(origin);
    current <= parseTimeToMinutes(lastStart);
    current += step
  ) {
    slots.push(minutesToTime(current));
  }
  return slots;
}

function filterPublicSlotsLikeBooking(input: {
  appointments: ReturnType<typeof shortenedManualAppointment>[];
  candidateDuration: number;
  candidateBreak: number;
  slotStep: number;
  gridOrigin: string;
  lastStart: string;
  onlineTimings: SlotChainTiming[];
  chainsEnabled: boolean;
}): string[] {
  const raw = generateRawGrid(input.gridOrigin, input.lastStart, input.slotStep).filter(
    (slot) => {
      const candidate = candidateAt(
        slot,
        input.candidateDuration,
        input.candidateBreak,
      );
      return publicAvailabilityForCandidate(input.appointments, candidate)
        .isAvailable;
    },
  );

  if (!input.chainsEnabled) {
    return raw;
  }

  const workWindows: SlotChainWorkWindow[] = [
    {
      startMinutes: parseTimeToMinutes("09:00"),
      lastStartMinutes: parseTimeToMinutes("18:00"),
      hardEndMinutes: null,
      constrainProcedureEnd: false,
    },
    {
      startMinutes: parseTimeToMinutes("08:40"),
      lastStartMinutes: parseTimeToMinutes("08:59"),
      hardEndMinutes: parseTimeToMinutes("09:00"),
      constrainProcedureEnd: true,
    },
  ];

  return filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: input.slotStep,
    gridOriginMinutes: parseTimeToMinutes(input.gridOrigin),
    workWindows,
    blockingIntervals: input.appointments
      .filter((appointment) => isBlockingAppointmentStatus(appointment.status))
      .map(publicBusyBlockingInterval),
    onlineTimings: input.onlineTimings,
  });
}

function testFormulaStandardEqualsActual(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("12:00"),
    breakAfterMinutes: 30,
    standardDurationMinutes: 120,
    standardBreakAfterMinutes: 30,
  });
  assertBusyEndsAt(busy, "12:30", "standard: endsAt + break");
  assert.equal(
    busy.endsAt.getTime(),
    toBusyInterval({
      startsAt: at("10:00"),
      endsAt: at("12:00"),
      breakAfterMinutes: 30,
    }).endsAt.getTime(),
  );
}

function testFormulaManualShortening(): void {
  const busy = toPublicBusyInterval(shortenedManualAppointment());
  // max(11:10, 10:00+120=12:00) + 30 = 12:30
  assertBusyEndsAt(busy, "12:30", "shortened: standard end + break");
  assert.notEqual(timeOf(busy.endsAt), "11:40");
}

function testFormulaManualElongation(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("13:00"),
    breakAfterMinutes: 30,
    standardDurationMinutes: 120,
    standardBreakAfterMinutes: 30,
  });
  // max(13:00, 12:00) + 30 = 13:30
  assertBusyEndsAt(busy, "13:30", "elongated: actual end + break");
}

function testFallbackNullStandardDuration(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes: 30,
    standardDurationMinutes: null,
    standardBreakAfterMinutes: 30,
  });
  assertBusyEndsAt(busy, "11:40", "null standard → actual endsAt + break");
}

function testFallbackBreakToStandardBreak(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes: null,
    standardDurationMinutes: 120,
    standardBreakAfterMinutes: 30,
  });
  assertBusyEndsAt(busy, "12:30", "break null → standardBreak");
}

function testFallbackBothBreaksNull(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes: null,
    standardDurationMinutes: 120,
    standardBreakAfterMinutes: null,
  });
  assertBusyEndsAt(busy, "12:00", "both breaks null → 0");
}

function testNegativeValuesClamped(): void {
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes: -15,
    standardDurationMinutes: -40,
    standardBreakAfterMinutes: -5,
  });
  // standardDuration clamped to 0 → procedure end = actual 11:10; break clamped 0
  assertBusyEndsAt(busy, "11:10", "negatives clamped safely");
}

function testInvalidDatesFallback(): void {
  const busy = toPublicBusyInterval({
    startsAt: new Date("invalid"),
    endsAt: at("11:10"),
    breakAfterMinutes: 30,
    standardDurationMinutes: 120,
  });
  assert.ok(Number.isFinite(busy.endsAt.getTime()));
  assertBusyEndsAt(busy, "11:40", "invalid start → actual+break fallback");
}

function testSlot1140Blocked(): void {
  const appointment = shortenedManualAppointment();
  const at1140 = publicAvailabilityForCandidate(
    [appointment],
    candidateAt("11:40", 90, 30),
  );
  assert.equal(at1140.isAvailable, false, "11:40 must be blocked publicly");
  assert.ok(at1140.conflicts.some((c) => c.type === "appointment"));

  const actualLegacy = actualAvailabilityForCandidate(
    [appointment],
    candidateAt("11:40", 90, 30),
  );
  assert.equal(
    actualLegacy.isAvailable,
    true,
    "actual busy still frees 11:40 for manager path",
  );
}

function testExtraWindow0840DoesNotOpen1140(): void {
  const appointment = shortenedManualAppointment();
  const result = publicAvailabilityForCandidate(
    [appointment],
    candidateAt("11:40", 60, 30),
    {
      extraWorkWindows: [{ startsAt: at("08:40"), endsAt: at("18:00") }],
    },
  );
  assert.equal(result.isAvailable, false, "extra 08:40 must not open 11:40");
}

function testScenario0840NextSlotWithChains(): void {
  /**
   * Сетка origin 08:40, step 60 → … 11:40, 12:40, 13:40, 14:40 …
   * Public busy: 10:00–12:30 → 11:40 внутри busy.
   * Первый grid ≥ 12:30 = 12:40.
   * Online fill timing 90+30=120 → next reachable = 14:40.
   * Итог: нет 11:40; первый после блока 12:40; затем 14:40 по chain.
   */
  const appointment = shortenedManualAppointment();
  const publicBusy = toPublicBusyInterval(appointment);
  assertBusyEndsAt(publicBusy, "12:30", "scenario public busy");

  const firstAfterBusy = firstGridStartOnOrAfter(
    parseTimeToMinutes(timeOf(publicBusy.endsAt)),
    parseTimeToMinutes("08:40"),
    60,
  );
  assert.equal(firstAfterBusy, parseTimeToMinutes("12:40"));

  const slots = filterPublicSlotsLikeBooking({
    appointments: [appointment],
    candidateDuration: 90,
    candidateBreak: 30,
    slotStep: 60,
    gridOrigin: "08:40",
    lastStart: "17:40",
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
    chainsEnabled: true,
  });

  assert.ok(!slots.includes("11:40"), `slots must not include 11:40: ${slots}`);
  assert.ok(slots.includes("12:40"), `first free after busy is 12:40: ${slots}`);
  assert.ok(
    slots.includes("14:40"),
    `chain next after 12:40+120 is 14:40: ${slots}`,
  );
  assert.ok(
    !slots.includes("13:40"),
    `13:40 not reachable by 90+30 chain from 12:40: ${slots}`,
  );
}

function testOverlappingAppointmentsTakeMaxBusy(): void {
  const shortA = shortenedManualAppointment();
  const longerB = {
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    breakAfterMinutes: 30,
    standardDurationMinutes: 150,
    standardBreakAfterMinutes: 30,
    status: "SCHEDULED" as const,
  };
  // A public → 12:30; B public → 10:00+150+30 = 13:00
  const busyA = toPublicBusyInterval(shortA);
  const busyB = toPublicBusyInterval(longerB);
  assertBusyEndsAt(busyA, "12:30", "A");
  assertBusyEndsAt(busyB, "13:00", "B longer conserved");

  const at1240 = publicAvailabilityForCandidate(
    [shortA, longerB],
    candidateAt("12:40", 60, 0),
  );
  assert.equal(at1240.isAvailable, false, "longer B keeps 12:40 blocked");

  const at1300 = publicAvailabilityForCandidate(
    [shortA, longerB],
    candidateAt("13:00", 60, 0),
  );
  assert.equal(at1300.isAvailable, true, "free at max busy end 13:00");
}

function testDuplicateManualDoesNotWidenSlots(): void {
  const one = [shortenedManualAppointment()];
  const two = [shortenedManualAppointment(), shortenedManualAppointment()];

  const slotsOne = filterPublicSlotsLikeBooking({
    appointments: one,
    candidateDuration: 90,
    candidateBreak: 30,
    slotStep: 60,
    gridOrigin: "08:40",
    lastStart: "17:40",
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
    chainsEnabled: true,
  });
  const slotsTwo = filterPublicSlotsLikeBooking({
    appointments: two,
    candidateDuration: 90,
    candidateBreak: 30,
    slotStep: 60,
    gridOrigin: "08:40",
    lastStart: "17:40",
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
    chainsEnabled: true,
  });

  assert.deepEqual(slotsTwo, slotsOne, "duplicate appointments must not widen slots");
}

function testAddingAppointmentNeverAddsEarlierSlots(): void {
  const before = filterPublicSlotsLikeBooking({
    appointments: [],
    candidateDuration: 90,
    candidateBreak: 30,
    slotStep: 60,
    gridOrigin: "08:40",
    lastStart: "17:40",
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
    chainsEnabled: true,
  });
  const after = filterPublicSlotsLikeBooking({
    appointments: [shortenedManualAppointment()],
    candidateDuration: 90,
    candidateBreak: 30,
    slotStep: 60,
    gridOrigin: "08:40",
    lastStart: "17:40",
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
    chainsEnabled: true,
  });

  for (const slot of after) {
    assert.ok(before.includes(slot), `new earlier/extra slot leaked: ${slot}`);
  }
  assert.ok(before.includes("11:40"));
  assert.ok(!after.includes("11:40"));
  assert.ok(
    after.every((slot) => parseTimeToMinutes(slot) >= parseTimeToMinutes("12:40")),
  );
}

function testBlockingStatusesMatchProductionHelper(): void {
  const blockingStatuses: AppointmentStatus[] = [
    "SCHEDULED",
    "CONFIRMED",
    "COMPLETED",
    "NO_SHOW",
  ];
  const nonBlockingStatuses: AppointmentStatus[] = [
    "CANCELLED",
    "RESCHEDULED",
  ];

  for (const status of blockingStatuses) {
    assert.equal(
      isBlockingAppointmentStatus(status),
      true,
      `${status}: helper must treat as blocking`,
    );
    const availability = publicAvailabilityForCandidate(
      [shortenedManualAppointment({ status })],
      candidateAt("11:40", 90, 30),
    );
    assert.equal(
      availability.isAvailable,
      false,
      `${status}: public availability must block 11:40`,
    );

    const chainSlots = filterPublicSlotsLikeBooking({
      appointments: [shortenedManualAppointment({ status })],
      candidateDuration: 90,
      candidateBreak: 30,
      slotStep: 60,
      gridOrigin: "08:40",
      lastStart: "17:40",
      onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
      chainsEnabled: true,
    });
    assert.ok(
      !chainSlots.includes("11:40"),
      `${status}: chain harness must block 11:40 via isBlockingAppointmentStatus`,
    );
  }

  for (const status of nonBlockingStatuses) {
    assert.equal(
      isBlockingAppointmentStatus(status),
      false,
      `${status}: helper must treat as non-blocking`,
    );
    const availability = publicAvailabilityForCandidate(
      [shortenedManualAppointment({ status })],
      candidateAt("11:40", 90, 30),
    );
    assert.equal(
      availability.isAvailable,
      true,
      `${status}: must not block public availability`,
    );

    const chainSlots = filterPublicSlotsLikeBooking({
      appointments: [shortenedManualAppointment({ status })],
      candidateDuration: 90,
      candidateBreak: 30,
      slotStep: 60,
      gridOrigin: "08:40",
      lastStart: "17:40",
      onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 30 }],
      chainsEnabled: true,
    });
    assert.ok(
      chainSlots.includes("11:40"),
      `${status}: chain harness must not treat as blocking`,
    );
  }
}

function testScheduleBlockRemainsStrict(): void {
  const result = publicAvailabilityForCandidate(
    [],
    candidateAt("11:40", 60, 0),
    {
      scheduleBlocks: [
        { startsAt: at("11:00"), endsAt: at("12:00"), isFullDay: false },
      ],
      extraWorkWindows: [],
    },
  );
  assert.equal(result.isAvailable, false);
  assert.ok(result.conflicts.some((c) => c.type === "block"));
}

function testFullDayBlockRemainsStrict(): void {
  const result = publicAvailabilityForCandidate(
    [],
    candidateAt("11:40", 60, 0),
    {
      scheduleBlocks: [
        { startsAt: at("00:00"), endsAt: at("23:59"), isFullDay: true },
      ],
      extraWorkWindows: [],
    },
  );
  assert.equal(result.isAvailable, false);
  assert.ok(result.conflicts.some((c) => c.type === "full_day_block"));
}

function testManagerOverlapOverrideStillWorksOnActualBusy(): void {
  const appointment = shortenedManualAppointment();
  const availability = actualAvailabilityForCandidate(
    [appointment],
    candidateAt("10:30", 60, 0),
  );
  assert.equal(availability.isAvailable, false);
  const allowed = resolveAppointmentWriteConflict(
    availability.conflicts,
    true,
  );
  assert.equal(allowed, null, "allowAppointmentOverlap clears appointment conflict");
  const blocked = resolveAppointmentWriteConflict(availability.conflicts, false);
  assert.equal(blocked?.code, "APPOINTMENT_OVERLAP");
}

function testInternalScheduleKeepsActualRange(): void {
  const display = buildScheduleAppointmentDisplay({
    startsAt: at("10:00").toISOString(),
    endsAt: at("11:10").toISOString(),
    serviceName: "Массаж",
    clientName: "Клиент",
  });
  assert.equal(display.timeLabel, "10:00–11:10");
}

function testSnapshotIgnoresLaterCatalogChange(): void {
  const snapshotDuration = 120;
  const liveCatalogDurationAfterEdit = 60;
  const busy = toPublicBusyInterval({
    startsAt: at("10:00"),
    endsAt: at("11:10"),
    breakAfterMinutes: 30,
    standardDurationMinutes: snapshotDuration,
    standardBreakAfterMinutes: 30,
  });
  assertBusyEndsAt(busy, "12:30", "snapshot wins");
  assert.notEqual(snapshotDuration, liveCatalogDurationAfterEdit);
  // Helper never accepts live catalog — only snapshot fields above.
}

function testStaticWiring(): void {
  const mas = stripComments(read("src/services/MasterAvailabilityService.ts"));
  assert.match(mas, /export function toPublicBusyInterval/);
  assert.match(mas, /export function toBusyInterval/);
  assert.match(mas, /usePublicBusyForAppointments/);

  const booking = stripComments(read("src/services/BookingService.ts"));
  assert.match(booking, /toPublicBusyInterval/);
  assert.match(booking, /usePublicBusyForAppointments:\s*true/);
  assert.match(booking, /standardDurationMinutes:\s*true/);
  assert.match(booking, /standardBreakAfterMinutes:\s*true/);
  assert.match(
    booking,
    /isBlockingAppointmentStatus/,
    "BookingService filters appointments via production helper",
  );
  assert.match(
    booking,
    /availableSlots\.includes\(input\.startTime\)/,
    "POST createOnlineBooking re-checks slot list",
  );

  const harness = stripComments(
    read("scripts/security-public-booking-conservative-busy-check.ts"),
  );
  assert.match(
    harness,
    /isBlockingAppointmentStatus\(appointment\.status\)/,
    "chain harness must use production status helper, not SCHEDULED-only",
  );

  const appointment = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(
    appointment,
    /usePublicBusyForExistingAppointments:\s*true/,
    "online create enables public busy in transaction",
  );
  assert.match(
    appointment,
    /createOnlineAppointment[\s\S]*usePublicBusyForExistingAppointments:\s*true/,
  );
  assert.match(appointment, /standardDurationMinutes:\s*true/);
  assert.match(
    appointment,
    /allowAppointmentOverlap:\s*options\?\.allowAppointmentOverlap === true/,
  );

  const createRoute = stripComments(read("src/app/api/booking/create/route.ts"));
  assert.doesNotMatch(createRoute, /allowAppointmentOverlap/);
  assert.match(createRoute, /createOnlineBooking/);

  const slotsRoute = stripComments(read("src/app/api/booking/slots/route.ts"));
  assert.match(slotsRoute, /getAvailableTimeSlots/);
}

function main(): void {
  testFormulaStandardEqualsActual();
  testFormulaManualShortening();
  testFormulaManualElongation();
  testFallbackNullStandardDuration();
  testFallbackBreakToStandardBreak();
  testFallbackBothBreaksNull();
  testNegativeValuesClamped();
  testInvalidDatesFallback();
  testSlot1140Blocked();
  testExtraWindow0840DoesNotOpen1140();
  testScenario0840NextSlotWithChains();
  testOverlappingAppointmentsTakeMaxBusy();
  testDuplicateManualDoesNotWidenSlots();
  testAddingAppointmentNeverAddsEarlierSlots();
  testBlockingStatusesMatchProductionHelper();
  testScheduleBlockRemainsStrict();
  testFullDayBlockRemainsStrict();
  testManagerOverlapOverrideStillWorksOnActualBusy();
  testInternalScheduleKeepsActualRange();
  testSnapshotIgnoresLaterCatalogChange();
  testStaticWiring();

  console.log("security-public-booking-conservative-busy-check: ok");
}

main();
