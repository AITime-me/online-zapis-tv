/**
 * Regression: доп. рабочие окна менеджера и публичные онлайн-слоты.
 * Без БД: статический аудит + unit-check availability.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolvePublicOnlineBookingHours,
} from "../src/lib/schedule/master-work-hours";
import { checkMasterIntervalAvailability } from "../src/services/MasterAvailabilityService";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";

const ROOT = path.resolve(__dirname, "..");
const MONDAY = "2026-07-20";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function defaultMaster() {
  return {
    workStart: "00:00",
    workEnd: "23:59",
    usesDefaultWorkHours: true,
  };
}

function assertManagerFormDefaultsOnlineEnabled(): void {
  const editor = read("src/components/schedule/quick-day-editor.tsx");

  assert.match(
    editor,
    /isOnlineBookingEnabled:\s*true/,
    "переключатель онлайн-записи должен быть включён по умолчанию",
  );
  assert.match(
    editor,
    /isOnlineBookingEnabled:\s*extraForm\.isOnlineBookingEnabled/,
    "значение переключателя должно явно уходить в POST",
  );
  assert.doesNotMatch(
    editor,
    /useState\(\{\s*startTime:[\s\S]*?isOnlineBookingEnabled:\s*false/,
    "начальный state формы не должен держать isOnlineBookingEnabled: false",
  );
}

function assertServicePersistsExplicitFlag(): void {
  const service = read("src/services/ExtraWorkWindowService.ts");
  assert.match(
    service,
    /isOnlineBookingEnabled:\s*input\.isOnlineBookingEnabled\s*\?\?\s*false/,
    "true из API должен сохраняться; отсутствие поля → false (внутреннее окно)",
  );

  const schema = read("prisma/schema.prisma");
  assert.match(
    schema,
    /model ExtraWorkWindow \{[\s\S]*?isOnlineBookingEnabled Boolean\s+@default\(false\)/,
    "DB default ExtraWorkWindow остаётся false — не менять слепо на true",
  );
}

function assertBookingLoadsOnlyOnlineWindows(): void {
  const booking = read("src/services/BookingService.ts");
  assert.match(
    booking,
    /extraWorkWindow\.findMany\(\{[\s\S]*?isOnlineBookingEnabled:\s*true/,
    "публичный BookingService загружает только окна с isOnlineBookingEnabled: true",
  );
  assert.match(
    booking,
    /export async function getAvailableDaysInMonth/,
    "доступные дни месяца строятся через публичные слоты",
  );
  assert.match(
    booking,
    /const slots = await getAvailableTimeSlots/,
    "день появляется в месяце только если есть доступные слоты",
  );
}

function testExtraWindowOutsideScheduleCreatesSlots(): void {
  const hours = resolvePublicOnlineBookingHours(defaultMaster(), MONDAY);
  assert.equal(hours.workStart, "09:00");

  const earlyWithoutExtra = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: MONDAY,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(MONDAY, "07:00")!,
      endsAt: parseStudioDateKey(MONDAY, "08:00")!,
    },
  });
  assert.equal(
    earlyWithoutExtra.isAvailable,
    false,
    "без доп. окна слот до обычного графика недоступен",
  );

  const earlyWithOnlineExtra = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: MONDAY,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [
      {
        startsAt: parseStudioDateKey(MONDAY, "07:00")!,
        endsAt: parseStudioDateKey(MONDAY, "09:00")!,
      },
    ],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(MONDAY, "07:00")!,
      endsAt: parseStudioDateKey(MONDAY, "08:00")!,
    },
  });
  assert.equal(
    earlyWithOnlineExtra.isAvailable,
    true,
    "доп. окно за пределами обычного графика создаёт доступный слот",
  );
}

function testOfflineExtraWindowDoesNotCreatePublicSlots(): void {
  const hours = resolvePublicOnlineBookingHours(defaultMaster(), MONDAY);

  // false → окно не попадает в loadSlotContext (фильтр isOnlineBookingEnabled: true),
  // поэтому в availability уходит пустой список — как на публичном /booking.
  const earlyWithOfflineExtra = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: MONDAY,
    standardWorkStart: hours.workStart,
    standardWorkEnd: hours.workEnd,
    constrainAppointmentEnd: hours.constrainAppointmentEnd,
    extraWorkWindows: [],
    appointments: [],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: parseStudioDateKey(MONDAY, "07:00")!,
      endsAt: parseStudioDateKey(MONDAY, "08:00")!,
    },
  });
  assert.equal(
    earlyWithOfflineExtra.isAvailable,
    false,
    "окно с isOnlineBookingEnabled: false не создаёт публичные слоты",
  );
  assert.ok(
    earlyWithOfflineExtra.conflicts.some((c) => c.type === "outside_work_hours"),
  );
}

function main(): void {
  assertManagerFormDefaultsOnlineEnabled();
  assertServicePersistsExplicitFlag();
  assertBookingLoadsOnlyOnlineWindows();
  testExtraWindowOutsideScheduleCreatesSlots();
  testOfflineExtraWindowDoesNotCreatePublicSlots();

  console.log("security-extra-work-online-slots-check: OK");
}

main();
