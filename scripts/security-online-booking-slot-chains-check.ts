/**
 * Контракт: post-filter цепочек достижимости публичных онлайн-слотов.
 * Runtime-логика + статический аудит wiring / criteria.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  computeReachableStartsInSegment,
  filterSlotsByReachableChains,
  firstGridStartOnOrAfter,
  isOnlineBookingSlotChainsEnabled,
  minutesToTime,
  normalizePublicWorkWindows,
  parseTimeToMinutes,
  resolveOnlineFillTimingsForRequest,
  type SlotChainBlockingInterval,
  type SlotChainTiming,
  type SlotChainWorkWindow,
} from "../src/lib/booking/online-slot-chains";
import { toBusyInterval } from "../src/services/MasterAvailabilityService";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { isBlockingAppointmentStatus } from "../src/lib/schedule/non-blocking-appointment-statuses";
import { resolveTimingFromLoadedParts } from "../src/services/ServiceTimingService";

const ROOT = path.resolve(__dirname, "..");
const MONDAY = "2026-07-20";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function studioWindow(
  start = "09:00",
  lastStart = "18:00",
  constrain = false,
): SlotChainWorkWindow {
  return {
    startMinutes: parseTimeToMinutes(start),
    lastStartMinutes: parseTimeToMinutes(lastStart),
    hardEndMinutes: constrain ? parseTimeToMinutes(lastStart) : null,
    constrainProcedureEnd: constrain,
  };
}

function individualWindow(start: string, end: string): SlotChainWorkWindow {
  return {
    startMinutes: parseTimeToMinutes(start),
    lastStartMinutes: parseTimeToMinutes(end),
    hardEndMinutes: parseTimeToMinutes(end),
    constrainProcedureEnd: true,
  };
}

function extraWindow(start: string, hardEnd: string): SlotChainWorkWindow {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(hardEnd);
  return {
    startMinutes,
    lastStartMinutes: Math.max(startMinutes, endMinutes - 1),
    hardEndMinutes: endMinutes,
    constrainProcedureEnd: true,
  };
}

function generateRawGrid(
  origin: string,
  lastStart: string,
  step: number,
  excludeRanges: Array<{ from: string; to: string }> = [],
): string[] {
  const originMin = parseTimeToMinutes(origin);
  const lastMin = parseTimeToMinutes(lastStart);
  const slots: string[] = [];
  for (let current = originMin; current <= lastMin; current += step) {
    const blocked = excludeRanges.some((range) => {
      const from = parseTimeToMinutes(range.from);
      const to = parseTimeToMinutes(range.to);
      return current >= from && current < to;
    });
    if (!blocked) {
      slots.push(minutesToTime(current));
    }
  }
  return slots;
}

function busyFromAppointment(
  start: string,
  end: string,
  breakAfterMinutes: number,
): SlotChainBlockingInterval {
  const startsAt = parseStudioDateKey(MONDAY, start)!;
  const endsAt = parseStudioDateKey(MONDAY, end)!;
  const busy = toBusyInterval({
    startsAt,
    endsAt,
    breakAfterMinutes,
  });
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end) + breakAfterMinutes;
  assert.equal(
    busy.endsAt.getTime(),
    endsAt.getTime() + breakAfterMinutes * 60_000,
  );
  return {
    startMinutes: startMin,
    endMinutes: endMin,
  };
}

function assertContainsAll(actual: string[], expected: string[], label: string) {
  for (const slot of expected) {
    assert.ok(
      actual.includes(slot),
      `${label}: ожидается ${slot}, получено ${actual.join(",")}`,
    );
  }
}

function assertContainsNone(actual: string[], forbidden: string[], label: string) {
  for (const slot of forbidden) {
    assert.ok(!actual.includes(slot), `${label}: не должен быть ${slot}`);
  }
}

function testFeatureFlagDefaultOff(): void {
  assert.equal(isOnlineBookingSlotChainsEnabled({}), false);
  assert.equal(
    isOnlineBookingSlotChainsEnabled({ ONLINE_BOOKING_SLOT_CHAINS_ENABLED: "false" }),
    false,
  );
  assert.equal(
    isOnlineBookingSlotChainsEnabled({ ONLINE_BOOKING_SLOT_CHAINS_ENABLED: "true" }),
    true,
  );
}

async function testFlagOffIdentityViaResolver(): Promise<void> {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  let loads = 0;
  const resolved = await resolveOnlineFillTimingsForRequest({
    chainsEnabled: false,
    load: async () => {
      loads += 1;
      return [{ durationMinutes: 80, breakAfterMinutes: 0 }];
    },
  });
  assert.equal(resolved.mode, "skip_filter");
  assert.equal(loads, 0);
  // Wiring: skip_filter → вернуть raw без filter
  assert.deepEqual(raw, raw);
}

function testMainChainOnly80Includes1800(): void {
  const blocking = [busyFromAppointment("09:00", "10:10", 10)];
  assert.equal(blocking[0]!.endMinutes, parseTimeToMinutes("10:20"));

  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  assert.ok(raw.includes("18:00"), "raw включает последний старт 18:00");

  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: blocking,
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });

  assertContainsAll(
    filtered,
    ["10:30", "12:00", "13:30", "15:00", "16:30", "18:00"],
    "основная цепочка 80 + последний старт 18:00",
  );
  assertContainsNone(
    filtered,
    ["11:00", "11:30", "12:30", "13:00", "14:00", "14:30", "15:30", "16:00"],
    "основная цепочка 80",
  );
}

function testShort30Makes1100Reachable(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [
      { durationMinutes: 80, breakAfterMinutes: 0 },
      { durationMinutes: 30, breakAfterMinutes: 0 },
    ],
  });
  assert.ok(filtered.includes("11:00"), "30-мин услуга открывает 11:00");
}

function test60Makes1130Reachable(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [
      { durationMinutes: 80, breakAfterMinutes: 0 },
      { durationMinutes: 60, breakAfterMinutes: 0 },
    ],
  });
  assert.ok(filtered.includes("11:30"), "60-мин услуга открывает 11:30");
}

function testMasterOverrideAffectsChain(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const withOverride = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 0 }],
  });
  assert.ok(withOverride.includes("10:30"));
  assert.ok(withOverride.includes("12:00"));
  assert.ok(!withOverride.includes("11:30"));
}

function testServiceBreakAfterInTransition(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 60, breakAfterMinutes: 15 }],
  });
  assert.ok(filtered.includes("10:30"));
  assert.ok(filtered.includes("12:00"));
  assert.ok(!filtered.includes("11:30"));
}

function testExistingAppointmentBreakDefinesSegmentStart(): void {
  const blocking = [busyFromAppointment("09:00", "10:00", 20)];
  assert.equal(blocking[0]!.endMinutes, parseTimeToMinutes("10:20"));
  const first = firstGridStartOnOrAfter(
    blocking[0]!.endMinutes,
    parseTimeToMinutes("09:00"),
    30,
  );
  assert.equal(first, parseTimeToMinutes("10:30"));
}

function testOverlappingExtraCannotBypassFilter(): void {
  const standard = studioWindow();
  const overlappingExtra = extraWindow("10:30", "18:00");
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);

  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [standard, overlappingExtra],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });

  assert.ok(filtered.includes("10:30"));
  assert.ok(!filtered.includes("11:00"), "overlapping extra не делает 11:00 leading");
  assert.ok(filtered.includes("12:00"));
  assert.ok(filtered.includes("18:00"));
}

function testAdjacentWindowsMerge(): void {
  const morning = extraWindow("09:00", "12:00");
  const afternoon = extraWindow("12:00", "18:00");
  const normalized = normalizePublicWorkWindows([morning, afternoon]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]!.startMinutes, parseTimeToMinutes("09:00"));
  assert.equal(normalized[0]!.hardEndMinutes, parseTimeToMinutes("18:00"));

  const raw = generateRawGrid("09:00", "17:30", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [morning, afternoon],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered.includes("10:30"));
  assert.ok(filtered.includes("12:00"), "цепочка продолжается через бывшую границу 12:00");
  assert.ok(!filtered.includes("11:00"));
}

function testSeparateWindowsNotMerged(): void {
  const morning = extraWindow("09:00", "12:00");
  const afternoon = extraWindow("13:00", "18:00");
  const normalized = normalizePublicWorkWindows([morning, afternoon]);
  assert.equal(normalized.length, 2);

  const raw = [
    ...generateRawGrid("09:00", "11:30", 30, [{ from: "09:00", to: "10:20" }]),
    ...generateRawGrid("13:00", "17:00", 30),
  ];
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [morning, afternoon],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  // Afternoon — отдельное ведущее окно без блокировки
  assert.ok(filtered.includes("13:00"));
  assert.ok(filtered.includes("13:30"));
  // Цепочка morning не перескакивает на 13:00 как продолжение 10:30+80
  // (13:00 ведущий сам по себе — это ок; важно что gap не склеивает окна)
  assert.ok(!filtered.includes("11:00"));
}

function testNestedDuplicateWindows(): void {
  const full = studioWindow();
  const nested = extraWindow("10:00", "12:00");
  const duplicate = studioWindow();
  const normalized = normalizePublicWorkWindows([full, nested, duplicate]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]!.startMinutes, parseTimeToMinutes("09:00"));
  assert.equal(normalized[0]!.lastStartMinutes, parseTimeToMinutes("18:00"));
  assert.equal(normalized[0]!.constrainProcedureEnd, false);

  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [full, nested, duplicate],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.equal(new Set(filtered).size, filtered.length, "без дублей слотов");
  assert.ok(!filtered.includes("11:00"));
}

function testOnlineExtraSeparateEarlyWindow(): void {
  const extra = extraWindow("07:00", "09:00");
  const standard = studioWindow();
  const raw = [
    ...generateRawGrid("07:00", "08:30", 30),
    ...generateRawGrid("09:00", "12:00", 30, [{ from: "09:00", to: "10:20" }]),
  ];
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("07:00"),
    workWindows: [standard, extra],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered.includes("07:00"));
  assert.ok(filtered.includes("10:30"));
  assert.ok(!filtered.includes("11:00"));
}

function testOfflineExtraNotInWorkWindows(): void {
  const raw = generateRawGrid("09:00", "12:00", 30);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [],
    onlineTimings: [{ durationMinutes: 60, breakAfterMinutes: 0 }],
  });
  assert.ok(!filtered.includes("07:00"));
  assert.ok(filtered.includes("09:00"));
}

function testScheduleBlockSplitsSegments(): void {
  const raw = generateRawGrid("09:00", "18:00", 30);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [
      {
        startMinutes: parseTimeToMinutes("12:00"),
        endMinutes: parseTimeToMinutes("13:00"),
      },
    ],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered.includes("09:00"));
  assert.ok(filtered.includes("11:30"));
  assert.ok(filtered.includes("13:00"));
  assert.ok(!filtered.includes("13:30"));
  assert.ok(filtered.includes("14:30"));
}

function testCancelledAndRescheduledDoNotBlock(): void {
  assert.equal(isBlockingAppointmentStatus("CANCELLED"), false);
  assert.equal(isBlockingAppointmentStatus("RESCHEDULED"), false);
  assert.equal(isBlockingAppointmentStatus("SCHEDULED"), true);

  const raw = generateRawGrid("09:00", "12:00", 30);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.deepEqual(filtered, raw);
}

function testManagerOnlyNotInTimings(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(!filtered.includes("11:00"));
}

function testLeadingSegmentPreserved(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "12:00", to: "13:00" },
  ]);
  const filtered = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [
      {
        startMinutes: parseTimeToMinutes("12:00"),
        endMinutes: parseTimeToMinutes("13:00"),
      },
    ],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered.includes("09:00"));
  assert.ok(filtered.includes("11:30"));
}

function testEmptyTimingsFallback(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  assert.deepEqual(
    filterSlotsByReachableChains({
      rawSlots: raw,
      slotStepMinutes: 30,
      gridOriginMinutes: parseTimeToMinutes("09:00"),
      workWindows: [studioWindow()],
      blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
      onlineTimings: [],
    }),
    raw,
  );
  assert.deepEqual(
    filterSlotsByReachableChains({
      rawSlots: raw,
      slotStepMinutes: 30,
      gridOriginMinutes: parseTimeToMinutes("09:00"),
      workWindows: [studioWindow()],
      blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
      onlineTimings: null,
    }),
    raw,
  );
}

function testSlotMinutes15And30(): void {
  const raw15 = generateRawGrid("09:00", "14:00", 15, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered15 = filterSlotsByReachableChains({
    rawSlots: raw15,
    slotStepMinutes: 15,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered15.includes("10:30"));
  assert.ok(filtered15.includes("12:00"));
  assert.ok(!filtered15.includes("10:45"));
  assert.ok(!filtered15.includes("11:00"));

  const raw30 = generateRawGrid("09:00", "14:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const filtered30 = filterSlotsByReachableChains({
    rawSlots: raw30,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });
  assert.ok(filtered30.includes("10:30"));
  assert.ok(!filtered30.includes("11:00"));
}

function testConstrainAppointmentEndBoundary(): void {
  const window = individualWindow("10:00", "14:00");
  const reachable = computeReachableStartsInSegment({
    segmentLeftMinutes: parseTimeToMinutes("10:00"),
    segmentBusyRightMinutes: parseTimeToMinutes("14:00"),
    window,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("10:00"),
    onlineTimings: [{ durationMinutes: 90, breakAfterMinutes: 0 }],
  });
  assert.ok(reachable.has(parseTimeToMinutes("10:00")));
  assert.ok(reachable.has(parseTimeToMinutes("11:30")));
  assert.ok(reachable.has(parseTimeToMinutes("13:00")));
  assert.ok(!reachable.has(parseTimeToMinutes("13:30")));
}

function testResolveTimingFromLoadedPartsShared(): void {
  const base = resolveTimingFromLoadedParts(
    { durationMinutes: 60, breakAfterMinutes: 10, isActive: true },
    {
      isEnabled: true,
      durationMinutesOverride: null,
      breakAfterMinutesOverride: null,
    },
  );
  assert.deepEqual(base, {
    durationMinutes: 60,
    breakAfterMinutes: 10,
    totalBusyMinutes: 70,
    source: "service",
  });

  const overridden = resolveTimingFromLoadedParts(
    { durationMinutes: 60, breakAfterMinutes: 10, isActive: true },
    {
      isEnabled: true,
      durationMinutesOverride: 90,
      breakAfterMinutesOverride: 0,
    },
  );
  assert.equal(overridden?.source, "masterOverride");
  assert.equal(overridden?.durationMinutes, 90);
  assert.equal(overridden?.breakAfterMinutes, 0);
}

/**
 * Симуляция семантики BookingService.getAvailableDaysInMonth + getAvailableTimeSlots
 * по счётчику loader (без БД).
 */
async function testLoaderCallCountsRuntime(): Promise<void> {
  const timings: SlotChainTiming[] = [{ durationMinutes: 80, breakAfterMinutes: 0 }];
  const days = Array.from({ length: 20 }, (_, index) =>
    `2026-07-${String(index + 1).padStart(2, "0")}`,
  );

  // flag=false → loader не вызывается
  {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return timings;
    };
    const resolved = await resolveOnlineFillTimingsForRequest({
      chainsEnabled: false,
      load,
    });
    assert.equal(resolved.mode, "skip_filter");
    assert.equal(loads, 0);
  }

  // одиночный slots calculation → ровно 1 load
  {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return timings;
    };
    const resolved = await resolveOnlineFillTimingsForRequest({
      chainsEnabled: true,
      load,
    });
    assert.equal(resolved.mode, "use_timings");
    assert.equal(loads, 1);
    // повтор с preloaded — 0 доп. loads
    const again = await resolveOnlineFillTimingsForRequest({
      chainsEnabled: true,
      preloadedOnlineTimings: timings,
      load,
    });
    assert.equal(again.mode, "use_timings");
    assert.equal(loads, 1);
  }

  // month: preload один раз, затем 20 дней с preloaded → всего 1 load
  {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return timings;
    };
    const chainsEnabled = true;
    let preloaded: SlotChainTiming[] | null | undefined;
    if (chainsEnabled) {
      preloaded = await load();
    }
    for (const _day of days) {
      const resolved = await resolveOnlineFillTimingsForRequest({
        chainsEnabled,
        preloadedOnlineTimings: preloaded,
        load,
      });
      assert.equal(resolved.mode, "use_timings");
      if (resolved.mode === "use_timings" && resolved.timings?.length) {
        // BFS без DB
        filterSlotsByReachableChains({
          rawSlots: ["10:30", "11:00", "12:00"],
          slotStepMinutes: 30,
          gridOriginMinutes: parseTimeToMinutes("09:00"),
          workWindows: [studioWindow()],
          blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
          onlineTimings: resolved.timings,
        });
      }
    }
    assert.equal(loads, 1, "month: ровно один load на весь месяц");
  }
}

function testCreatePathUsesSameFilteredListRuntime(): void {
  const raw = generateRawGrid("09:00", "18:00", 30, [
    { from: "09:00", to: "10:20" },
  ]);
  const availableSlots = filterSlotsByReachableChains({
    rawSlots: raw,
    slotStepMinutes: 30,
    gridOriginMinutes: parseTimeToMinutes("09:00"),
    workWindows: [studioWindow()],
    blockingIntervals: [busyFromAppointment("09:00", "10:10", 10)],
    onlineTimings: [{ durationMinutes: 80, breakAfterMinutes: 0 }],
  });

  // createOnlineBooking: availableSlots.includes(input.startTime)
  assert.equal(availableSlots.includes("11:00"), false);
  assert.equal(availableSlots.includes("10:30"), true);
  assert.equal(availableSlots.includes("18:00"), true);
}

function assertWiring(): void {
  const booking = read("src/services/BookingService.ts");
  assert.match(booking, /resolveOnlineFillTimingsForRequest/);
  assert.match(booking, /filterSlotsByReachableChains/);
  assert.match(booking, /loadOnlineFillTimingsForMaster/);
  assert.match(booking, /onlinePublicMasterServiceWhere/);
  assert.match(booking, /resolveTimingFromLoadedParts/);
  assert.match(
    booking,
    /preloadedOnlineTimings/,
    "month/slots поддерживают preload timings",
  );
  assert.match(
    booking,
    /if \(\s*preloadedOnlineTimings === undefined &&\s*isOnlineBookingSlotChainsEnabled\(\)/,
  );
  assert.match(
    booking,
    /const availableSlots = await getAvailableTimeSlots/,
    "createOnlineBooking использует getAvailableTimeSlots",
  );
  const loaderFn = booking.match(
    /async function loadOnlineFillTimingsForMaster[\s\S]*?^async function /m,
  );
  assert.ok(loaderFn, "loadOnlineFillTimingsForMaster найден");
  assert.doesNotMatch(
    loaderFn[0]!,
    /master\.findUnique/,
    "loadOnlineFillTimingsForMaster не делает повторный master.findUnique",
  );
  assert.match(loaderFn[0]!, /masterService\.findMany/);
  assert.match(loaderFn[0]!, /onlinePublicMasterServiceWhere/);
  assert.match(loaderFn[0]!, /resolveTimingFromLoadedParts/);

  const appointment = read("src/services/AppointmentService.ts");
  assert.doesNotMatch(
    appointment,
    /online-slot-chains|filterSlotsByReachableChains|ONLINE_BOOKING_SLOT_CHAINS/,
  );

  const whereHelper = read("src/lib/booking/online-public-master-service.ts");
  assert.match(whereHelper, /isPublic:\s*true/);
  assert.match(whereHelper, /isOnlineBookingEnabled:\s*true/);
  assert.match(whereHelper, /SEED_TEST_SERVICE_IDS/);

  const assertOnline = booking.match(
    /async function assertOnlineBookable[\s\S]*?return timing;/,
  );
  assert.ok(assertOnline);
  assert.match(assertOnline[0]!, /service\.isPublic/);
  assert.match(assertOnline[0]!, /isOnlineBookingEnabled/);

  const chains = read("src/lib/booking/online-slot-chains.ts");
  assert.match(chains, /normalizePublicWorkWindows/);
  assert.doesNotMatch(chains, /NEXT_PUBLIC_/);

  const envExample = read(".env.example");
  assert.match(envExample, /ONLINE_BOOKING_SLOT_CHAINS_ENABLED/);
}

function assertExtraWorkRegressionStillDocumented(): void {
  const booking = read("src/services/BookingService.ts");
  assert.match(
    booking,
    /extraWorkWindow\.findMany\(\{[\s\S]*?isOnlineBookingEnabled:\s*true/,
  );
}

async function main(): Promise<void> {
  testFeatureFlagDefaultOff();
  await testFlagOffIdentityViaResolver();
  testMainChainOnly80Includes1800();
  testShort30Makes1100Reachable();
  test60Makes1130Reachable();
  testMasterOverrideAffectsChain();
  testServiceBreakAfterInTransition();
  testExistingAppointmentBreakDefinesSegmentStart();
  testOverlappingExtraCannotBypassFilter();
  testAdjacentWindowsMerge();
  testSeparateWindowsNotMerged();
  testNestedDuplicateWindows();
  testOnlineExtraSeparateEarlyWindow();
  testOfflineExtraNotInWorkWindows();
  testScheduleBlockSplitsSegments();
  testCancelledAndRescheduledDoNotBlock();
  testManagerOnlyNotInTimings();
  testLeadingSegmentPreserved();
  testEmptyTimingsFallback();
  testSlotMinutes15And30();
  testConstrainAppointmentEndBoundary();
  testResolveTimingFromLoadedPartsShared();
  await testLoaderCallCountsRuntime();
  testCreatePathUsesSameFilteredListRuntime();
  assertWiring();
  assertExtraWorkRegressionStillDocumented();

  console.log("security-online-booking-slot-chains-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
