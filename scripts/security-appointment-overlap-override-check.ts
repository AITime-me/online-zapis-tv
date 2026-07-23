/**
 * Регрессия/security: ручной create может обойти только appointment-overlap
 * через allowAppointmentOverlap === true (OWNER/MANAGER path).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { checkMasterIntervalAvailability } from "../src/services/MasterAvailabilityService";
import {
  resolveAppointmentWriteConflict,
} from "../src/lib/schedule/appointment-write-conflicts";

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

function testResolveConflictCodesWithoutFlag(): void {
  const overlap = resolveAppointmentWriteConflict(
    [{ type: "appointment" }],
    false,
  );
  assert.deepEqual(overlap, {
    message: "У мастера уже есть запись или перерыв в это время.",
    code: "APPOINTMENT_OVERLAP",
    conflictType: "appointment",
  });

  // Нестрогое truthy не должно снимать конфликт: API/service сравнивают с === true.
  const notStrictTrue = resolveAppointmentWriteConflict(
    [{ type: "appointment" }],
    Boolean(1) && false,
  );
  assert.equal(notStrictTrue?.code, "APPOINTMENT_OVERLAP");
}

function testResolveConflictAllowsOverlapOnlyWithStrictTrue(): void {
  const allowed = resolveAppointmentWriteConflict(
    [{ type: "appointment" }],
    true,
  );
  assert.equal(allowed, null);
}

function testResolveConflictNeverSkipsBlocks(): void {
  const intervalBlock = resolveAppointmentWriteConflict(
    [{ type: "block" }],
    true,
  );
  assert.deepEqual(intervalBlock, {
    message: "Это время закрыто блоком",
    code: "SCHEDULE_BLOCK",
    conflictType: "block",
  });

  const fullDay = resolveAppointmentWriteConflict(
    [{ type: "full_day_block" }],
    true,
  );
  assert.deepEqual(fullDay, {
    message: "День мастера закрыт",
    code: "FULL_DAY_BLOCK",
    conflictType: "full_day_block",
  });

  const appointmentPlusBlock = resolveAppointmentWriteConflict(
    [{ type: "appointment" }, { type: "block" }],
    true,
  );
  assert.equal(appointmentPlusBlock?.code, "SCHEDULE_BLOCK");
  assert.equal(appointmentPlusBlock?.conflictType, "block");

  const appointmentPlusFullDay = resolveAppointmentWriteConflict(
    [{ type: "appointment" }, { type: "full_day_block" }],
    true,
  );
  assert.equal(appointmentPlusFullDay?.code, "FULL_DAY_BLOCK");
}

function testAvailabilityDetectsCombinedConflicts(): void {
  const startsAt = at("10:00");
  const endsAt = at("11:00");

  const combined = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "20:00",
    constrainAppointmentEnd: true,
    extraWorkWindows: [],
    appointments: [
      {
        startsAt: at("10:30"),
        endsAt: at("11:30"),
        breakAfterMinutes: 0,
        status: "SCHEDULED",
      },
    ],
    scheduleBlocks: [
      {
        startsAt: at("10:00"),
        endsAt: at("10:15"),
        isFullDay: false,
      },
    ],
    candidateInterval: { startsAt, endsAt, breakAfterMinutes: 0 },
  });

  assert.ok(combined.conflicts.some((c) => c.type === "appointment"));
  assert.ok(combined.conflicts.some((c) => c.type === "block"));

  const decision = resolveAppointmentWriteConflict(combined.conflicts, true);
  assert.equal(decision?.code, "SCHEDULE_BLOCK");
}

function testAvailabilityDetectsFullDayBlock(): void {
  const fullDay = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "20:00",
    constrainAppointmentEnd: true,
    extraWorkWindows: [],
    appointments: [
      {
        startsAt: at("12:00"),
        endsAt: at("13:00"),
        breakAfterMinutes: 15,
        status: "SCHEDULED",
      },
    ],
    scheduleBlocks: [
      {
        startsAt: at("00:00"),
        endsAt: at("23:59"),
        isFullDay: true,
      },
    ],
    candidateInterval: {
      startsAt: at("12:30"),
      endsAt: at("13:00"),
      breakAfterMinutes: 0,
    },
  });

  // full_day_block возвращается раньше проверки appointment — override всё равно запрещён
  assert.deepEqual(
    fullDay.conflicts.map((c) => c.type),
    ["full_day_block"],
  );
  assert.equal(
    resolveAppointmentWriteConflict(fullDay.conflicts, true)?.code,
    "FULL_DAY_BLOCK",
  );
}

function testBreakTailCountsAsAppointmentConflict(): void {
  const availability = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "20:00",
    constrainAppointmentEnd: true,
    extraWorkWindows: [],
    appointments: [
      {
        startsAt: at("10:00"),
        endsAt: at("11:00"),
        breakAfterMinutes: 15,
        status: "SCHEDULED",
      },
    ],
    scheduleBlocks: [],
    candidateInterval: {
      startsAt: at("11:00"),
      endsAt: at("11:30"),
      breakAfterMinutes: 0,
    },
  });

  assert.deepEqual(
    availability.conflicts.map((c) => c.type),
    ["appointment"],
  );
  assert.equal(
    resolveAppointmentWriteConflict(availability.conflicts, false)?.code,
    "APPOINTMENT_OVERLAP",
  );
  assert.equal(
    resolveAppointmentWriteConflict(availability.conflicts, true),
    null,
  );
}

function testManualApiExposesMachineCodesAndStrictFlag(): void {
  const route = stripComments(read("src/app/api/appointments/route.ts"));
  const service = stripComments(read("src/services/AppointmentService.ts"));

  assert.match(route, /requireProtectedMutatingApi\(\s*WRITE_SCHEDULE_ROLES/);
  assert.match(route, /allowAppointmentOverlap === true/);
  assert.match(route, /createAppointment\([\s\S]*\{ allowAppointmentOverlap \}/);
  assert.match(route, /error\.code/);
  assert.match(route, /error\.conflictType/);
  assert.match(route, /code:\s*error\.code/);

  assert.match(service, /resolveAppointmentWriteConflict/);
  assert.match(
    stripComments(read("src/lib/schedule/appointment-write-conflicts.ts")),
    /export function resolveAppointmentWriteConflict/,
  );
  assert.match(
    stripComments(read("src/lib/schedule/appointment-write-conflicts.ts")),
    /code:\s*"APPOINTMENT_OVERLAP"/,
  );
  assert.match(
    stripComments(read("src/lib/schedule/appointment-write-conflicts.ts")),
    /code:\s*"SCHEDULE_BLOCK"/,
  );
  assert.match(
    stripComments(read("src/lib/schedule/appointment-write-conflicts.ts")),
    /code:\s*"FULL_DAY_BLOCK"/,
  );
  assert.match(
    stripComments(read("src/lib/schedule/appointment-write-conflicts.ts")),
    /allowAppointmentOverlap !== true/,
    "overlap снимается только при строгом true",
  );
  assert.match(
    service,
    /export async function createAppointment\([\s\S]*options\?: CreateAppointmentOptions/,
  );
  assert.match(
    service,
    /allowAppointmentOverlap: options\?\.allowAppointmentOverlap === true/,
  );

  const onlineStart = service.indexOf(
    "export async function createOnlineAppointment",
  );
  const recordStart = service.indexOf(
    "async function createAppointmentRecord",
    onlineStart,
  );
  assert.ok(onlineStart >= 0 && recordStart > onlineStart);
  const onlineFn = service.slice(onlineStart, recordStart);
  assert.doesNotMatch(
    onlineFn,
    /allowAppointmentOverlap/,
    "public createOnlineAppointment не передаёт options override",
  );
  assert.match(
    onlineFn,
    /createAppointmentRecord\([\s\S]*,\s*null/,
    "online create всё ещё без createdBy user",
  );
  assert.match(
    service,
    /getAppointmentBusyInterval/,
    "online and internal conflict paths use the central busy resolver",
  );

  const updateStart = service.indexOf("export async function updateAppointment");
  assert.ok(updateStart >= 0);
  const updateFn = service.slice(updateStart);
  assert.match(
    updateFn,
    /const wasBlocking = isBlockingAppointmentStatus\(existing\.status\)/,
  );
  assert.match(
    updateFn,
    /options\?\.allowAppointmentOverlap === true\s*\|\|\s*\(!timingDirty && wasBlocking && willBeBlocking\)/,
    "auto-allow только для уже blocking + !timingDirty; активация требует флаг",
  );
  assert.doesNotMatch(
    updateFn,
    /options\?\.allowAppointmentOverlap === true \|\| !timingDirty;/,
    "небезопасная формула только по !timingDirty не должна остаться",
  );
  assert.match(
    updateFn,
    /assertNoBlockingConflict\(\s*tx,\s*merged,\s*id,/,
    "PATCH исключает редактируемую запись из self-conflict",
  );
  assert.match(
    service,
    /if \(desiredFreeAt <= startsAt\) \{\s*throw new AppointmentValidationError/,
    "некорректный интервал отклоняется до учёта override",
  );
  assert.match(
    service,
    /startsAt,\s*endsAt:\s*timingWrite\.endsAt,/,
    "create writes timing through the central adapter",
  );
  assert.match(
    service,
    /isManualTimeOverride:\s*timingWrite\.isManualTimeOverride/,
    "adapter сохраняет manual-time marker для нестандартного endTime",
  );
}

function testPublicBookingIgnoresOverlapFlag(): void {
  const bookingService = stripComments(read("src/services/BookingService.ts"));
  const bookingRoute = stripComments(
    read("src/app/api/booking/create/route.ts"),
  );

  assert.doesNotMatch(bookingService, /allowAppointmentOverlap/);
  assert.doesNotMatch(bookingRoute, /allowAppointmentOverlap/);
  assert.match(
    bookingService,
    /export type OnlineBookingInput = \{[\s\S]*serviceId: string;[\s\S]*masterId: string;[\s\S]*date: string;[\s\S]*startTime: string;/,
  );
  assert.match(
    bookingRoute,
    /createOnlineBooking\(\{[\s\S]*serviceId: body\.serviceId,[\s\S]*masterId: body\.masterId,[\s\S]*date: body\.date,[\s\S]*startTime: body\.startTime,/,
  );
  assert.doesNotMatch(
    bookingRoute,
    /createOnlineBooking\([\s\S]*\.\.\.body/,
    "публичный route не пробрасывает сырой body",
  );
}

function testPatchRouteSupportsOverlapOverride(): void {
  const patchRoute = stripComments(
    read("src/app/api/appointments/[id]/route.ts"),
  );
  assert.match(patchRoute, /allowAppointmentOverlap === true/);
  assert.match(
    patchRoute,
    /updateAppointment\(\s*id,\s*appointmentInput,\s*\{\s*allowAppointmentOverlap,?\s*\}\s*\)/,
  );
  assert.match(
    patchRoute,
    /error\.code \? \{ code: error\.code \}/,
    "PATCH возвращает машинный code для overlap-confirm UI",
  );
}

function testUiOverlapConfirmFlow(): void {
  const form = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );

  assert.match(form, /payload\.code === "APPOINTMENT_OVERLAP"/);
  assert.match(form, /На это время у мастера уже есть запись/);
  assert.match(form, /Создать всё равно/);
  assert.match(form, /Сохранить всё равно/);
  assert.match(form, /showOverlapConfirm/);
  assert.match(form, /submitCreate\(false\)/);
  assert.match(form, /submitCreate\(true\)/);
  assert.match(form, /save\(false\)/);
  assert.match(form, /save\(true\)/);
  assert.match(
    form,
    /if \(allowAppointmentOverlap\) \{[\s\S]*payloadBody\.allowAppointmentOverlap = true/,
  );
  assert.match(
    form,
    /const payloadBody: Record<string, unknown> = \{[\s\S]*masterId,[\s\S]*dateKey,[\s\S]*\.\.\.form/,
    "первый запрос собирается без флага по умолчанию",
  );
  assert.match(form, /if \(isSubmittingRef\.current\) \{\s*return;/);
  assert.match(form, /disabled=\{isSubmitting\}/);
  assert.doesNotMatch(form, /window\.confirm/);
  assert.match(
    form,
    /payload\.code === "APPOINTMENT_OVERLAP" &&\s*!allowAppointmentOverlap/,
    "предупреждение только при машинном коде и только на первой попытке",
  );
  assert.doesNotMatch(
    form,
    /payload\.error\s*===|payload\.error\s*\.includes|payload\.error\s*\.startsWith/,
    "UI не ветвит overlap-confirm по тексту ошибки",
  );

  assert.match(form, /overlapCancelButtonRef/);
  assert.match(form, /overlapConfirmButtonRef/);
  assert.match(form, /submitButtonRef/);
  assert.match(form, /overlapDialogRef/);
  assert.match(
    form,
    /overlapCancelButtonRef\.current\?\.focus\(\)/,
    "начальный фокус на «Отмена»",
  );
  assert.match(form, /event\.key === "Escape"/);
  assert.match(
    form,
    /event\.key === "Escape"[\s\S]*isSubmittingRef\.current[\s\S]*dismissOverlapConfirm/,
    "Escape закрывает предупреждение, но не во время повторного submit",
  );
  assert.match(form, /restoreFocusToSubmit|submitButtonRef\.current\?\.focus\(\)/);
  assert.match(form, /event\.key !== "Tab"|event\.key === "Tab"/);
  assert.match(
    form,
    /shiftKey[\s\S]*cancelBtn[\s\S]*confirmBtn|confirmBtn[\s\S]*cancelBtn/,
    "focus trap между «Отмена» и «Создать всё равно»",
  );
  assert.match(
    form,
    /tabIndex=\{showOverlapConfirm \? -1 : undefined\}/,
    "штатные кнопки формы не в Tab-порядке при открытом alertdialog",
  );
  assert.match(
    form,
    /ref=\{submitButtonRef\}[\s\S]*disabled=\{isSubmitting \|\| showOverlapConfirm\}/,
    "основная кнопка submit отключена при открытом overlap-confirm",
  );
  assert.match(
    form,
    /disabled=\{isSubmitting \|\| showOverlapConfirm\}[\s\S]*Отмена/,
    "штатная «Отмена» формы недоступна, пока открыт alertdialog",
  );
  assert.match(
    form,
    /disabled=\{isSubmitting\}[\s\S]*Создать всё равно|Создать всё равно[\s\S]*disabled=\{isSubmitting\}/,
  );
}

function main(): void {
  testResolveConflictCodesWithoutFlag();
  testResolveConflictAllowsOverlapOnlyWithStrictTrue();
  testResolveConflictNeverSkipsBlocks();
  testAvailabilityDetectsCombinedConflicts();
  testAvailabilityDetectsFullDayBlock();
  testBreakTailCountsAsAppointmentConflict();
  testManualApiExposesMachineCodesAndStrictFlag();
  testPublicBookingIgnoresOverlapFlag();
  testPatchRouteSupportsOverlapOverride();
  testUiOverlapConfirmFlow();
  console.log("security-appointment-overlap-override-check: OK");
}

main();
