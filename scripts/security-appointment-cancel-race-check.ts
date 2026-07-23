/**
 * Регрессия: гонка debounce PATCH после мягкой отмены записи (DELETE).
 * Без БД — статический аудит клиента, сервера и фильтра активной сетки.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  activeScheduleAppointmentWhere,
  HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES,
  isBlockingAppointmentStatus,
  isHiddenFromActiveSchedule,
  NON_BLOCKING_APPOINTMENT_STATUSES,
} from "../src/lib/schedule/non-blocking-appointment-statuses";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertStatusContracts(): void {
  assert.ok(NON_BLOCKING_APPOINTMENT_STATUSES.includes("CANCELLED"));
  assert.ok(NON_BLOCKING_APPOINTMENT_STATUSES.includes("RESCHEDULED"));
  assert.equal(isBlockingAppointmentStatus("CANCELLED"), false);
  assert.equal(isBlockingAppointmentStatus("RESCHEDULED"), false);

  assert.deepEqual(HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES, ["CANCELLED"]);
  assert.equal(isHiddenFromActiveSchedule("CANCELLED"), true);
  assert.equal(isHiddenFromActiveSchedule("RESCHEDULED"), false);
  assert.equal(isHiddenFromActiveSchedule("COMPLETED"), false);
  assert.equal(isHiddenFromActiveSchedule("SCHEDULED"), false);
  assert.equal(isHiddenFromActiveSchedule("CONFIRMED"), false);

  const where = activeScheduleAppointmentWhere();
  assert.deepEqual(where.status.notIn, ["CANCELLED"]);
  assert.ok(!where.status.notIn.includes("RESCHEDULED"));
}

function assertEditorCancelsDebounceBeforeDelete(): void {
  const src = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );

  assert.match(src, /isCancellingRef/);
  assert.match(src, /cancelledRef/);
  assert.match(src, /clearPendingSave/);
  assert.match(src, /AbortController/);
  assert.match(src, /const handleCancel = async \(\) => \{[\s\S]*clearPendingSave\(\)/);
  assert.match(
    src,
    /const handleCancel = async \(\) => \{[\s\S]*isCancellingRef\.current = true/,
  );
  assert.match(
    src,
    /const scheduleSave = useCallback\(\(\) => \{[\s\S]*isCancellingRef\.current/,
  );
  assert.match(
    src,
    /const handleBlur = \(\) => \{[\s\S]*isCancellingRef\.current/,
  );
  assert.match(
    src,
    /const save = useCallback\(\s*async \(allowAppointmentOverlap = false\) => \{[\s\S]*isCancellingRef\.current/,
  );
  assert.match(src, /disabled=\{isCancelling \|\| showOverlapConfirm\}/);
  assert.match(src, /method:\s*"DELETE"/);
}

function assertServerRejectsPatchAfterCancel(): void {
  const src = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(
    src,
    /if \(existing\.status === "CANCELLED"\)[\s\S]*уже отменена/,
  );
  assert.match(src, /export async function cancelAppointment/);
  assert.match(
    src,
    /if \(existing\.status === "CANCELLED"\)[\s\S]*return mapAppointment\(existing\)/,
  );
  assert.match(src, /Запись не найдена/);
}

function assertActiveScheduleFiltersCancelledOnly(): void {
  for (const rel of [
    "src/services/ScheduleDayService.ts",
    "src/services/ScheduleMonthService.ts",
    "src/services/ExtraWorkWindowService.ts",
  ]) {
    const src = stripComments(read(rel));
    assert.match(
      src,
      /activeScheduleAppointmentWhere/,
      `${rel} должен фильтровать через activeScheduleAppointmentWhere`,
    );
    assert.doesNotMatch(
      src,
      /status:\s*\{\s*notIn:\s*\[\s*\.\.\.NON_BLOCKING_APPOINTMENT_STATUSES/,
      `${rel} не должен скрывать RESCHEDULED через NON_BLOCKING`,
    );
  }
}

function main(): void {
  assertStatusContracts();
  assertEditorCancelsDebounceBeforeDelete();
  assertServerRejectsPatchAfterCancel();
  assertActiveScheduleFiltersCancelledOnly();
  console.log("security-appointment-cancel-race-check: OK");
}

main();
