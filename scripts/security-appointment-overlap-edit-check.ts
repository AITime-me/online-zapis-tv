/**
 * Регрессия: редактирование уже пересекающихся записей.
 *
 * In-memory harness повторяет семантику updateAppointment
 * (timingDirty + wasBlocking/willBeBlocking + resolveAppointmentWriteConflict).
 * H–I: статический аудит публичного booking и MASTER access.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AppointmentStatus } from "@prisma/client";
import { WRITE_SCHEDULE_ROLES } from "../src/lib/auth/api-access";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { isAppointmentTimingDirty } from "../src/lib/schedule/appointment-timing-write";
import { resolveAppointmentWriteConflict } from "../src/lib/schedule/appointment-write-conflicts";
import { isBlockingAppointmentStatus } from "../src/lib/schedule/non-blocking-appointment-statuses";
import {
  checkMasterIntervalAvailability,
  type BusyInterval,
} from "../src/services/MasterAvailabilityService";

const ROOT = process.cwd();
const DATE_KEY = "2099-07-20";

type StoredAppointment = BusyInterval & {
  id: string;
  status: AppointmentStatus;
  clientName: string;
  clientPhone: string;
  comment: string | null;
  importantNote: string | null;
  masterId: string;
  serviceId: string | null;
  dateKey: string;
};

type ScheduleBlock = {
  startsAt: Date;
  endsAt: Date;
  isFullDay?: boolean;
};

type TestStore = {
  appointments: StoredAppointment[];
  scheduleBlocks: ScheduleBlock[];
};

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
  assert.ok(value);
  return value;
}

function emptyStore(): TestStore {
  return { appointments: [], scheduleBlocks: [] };
}

/**
 * Сервисная семантика allow на update:
 * explicit flag OR (!timingDirty && wasBlocking && willBeBlocking)
 */
function resolveUpdateAllowAppointmentOverlap(input: {
  allowAppointmentOverlapFlag: boolean;
  timingDirty: boolean;
  wasBlocking: boolean;
  willBeBlocking: boolean;
}): boolean {
  return (
    input.allowAppointmentOverlapFlag === true ||
    (!input.timingDirty && input.wasBlocking && input.willBeBlocking)
  );
}

function tryWrite(
  store: TestStore,
  candidate: {
    id?: string;
    startsAt: Date;
    endsAt: Date;
    breakAfterMinutes?: number;
    clientName?: string;
    clientPhone?: string;
    comment?: string | null;
    importantNote?: string | null;
    status?: AppointmentStatus;
  },
  options: {
    excludeAppointmentId?: string;
    allowAppointmentOverlap: boolean;
    skipConflictCheck?: boolean;
  },
):
  | { ok: true; id: string; record: StoredAppointment }
  | { ok: false; code: string } {
  if (!options.skipConflictCheck) {
    const others = store.appointments.filter(
      (item) => item.id !== options.excludeAppointmentId,
    );

    const availability = checkMasterIntervalAvailability({
      masterId: "m1",
      dateKey: DATE_KEY,
      standardWorkStart: "09:00",
      standardWorkEnd: "20:00",
      constrainAppointmentEnd: true,
      extraWorkWindows: [],
      appointments: others,
      scheduleBlocks: store.scheduleBlocks,
      candidateInterval: {
        startsAt: candidate.startsAt,
        endsAt: candidate.endsAt,
        breakAfterMinutes: candidate.breakAfterMinutes ?? 0,
      },
    });

    const blocking = resolveAppointmentWriteConflict(
      availability.conflicts,
      options.allowAppointmentOverlap,
    );
    if (blocking) {
      return { ok: false, code: blocking.code };
    }
  }

  if (candidate.id) {
    const index = store.appointments.findIndex(
      (item) => item.id === candidate.id,
    );
    assert.ok(index >= 0, "обновляемая запись должна существовать");
    const prev = store.appointments[index]!;
    const next: StoredAppointment = {
      ...prev,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      breakAfterMinutes: candidate.breakAfterMinutes ?? prev.breakAfterMinutes,
      clientName: candidate.clientName ?? prev.clientName,
      clientPhone: candidate.clientPhone ?? prev.clientPhone,
      comment: candidate.comment !== undefined ? candidate.comment : prev.comment,
      importantNote:
        candidate.importantNote !== undefined
          ? candidate.importantNote
          : prev.importantNote,
      status: candidate.status ?? prev.status,
    };
    store.appointments[index] = next;
    return { ok: true, id: next.id, record: next };
  }

  const id = `appt-${store.appointments.length + 1}`;
  const created: StoredAppointment = {
    id,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    breakAfterMinutes: candidate.breakAfterMinutes ?? 0,
    status: candidate.status ?? "SCHEDULED",
    clientName: candidate.clientName ?? "Client",
    clientPhone: candidate.clientPhone ?? "+70000000000",
    comment: candidate.comment ?? null,
    importantNote: candidate.importantNote ?? null,
    masterId: "m1",
    serviceId: "svc1",
    dateKey: DATE_KEY,
  };
  store.appointments.push(created);
  return { ok: true, id, record: created };
}

function patchAppointment(
  store: TestStore,
  id: string,
  patch: {
    startsAt?: Date;
    endsAt?: Date;
    clientName?: string;
    clientPhone?: string;
    comment?: string | null;
    importantNote?: string | null;
    status?: AppointmentStatus;
  },
  allowAppointmentOverlapFlag = false,
):
  | { ok: true; record: StoredAppointment }
  | { ok: false; code: string } {
  const existing = store.appointments.find((item) => item.id === id);
  assert.ok(existing, "запись для PATCH должна существовать");

  const desiredStartsAt = patch.startsAt ?? existing.startsAt;
  const desiredFreeAt = patch.endsAt ?? existing.endsAt;
  const desiredStatus = patch.status ?? existing.status;

  const timingDirty = isAppointmentTimingDirty({
    current: {
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      breakAfterMinutes: existing.breakAfterMinutes ?? 0,
      standardDurationMinutes: null,
      standardBreakAfterMinutes: null,
      isManualTimeOverride: false,
      timingSemanticsVersion: 2,
    },
    currentServiceId: existing.serviceId,
    currentMasterId: existing.masterId,
    currentDateKey: existing.dateKey,
    desiredStartsAt,
    desiredFreeAt,
    desiredServiceId: existing.serviceId,
    desiredMasterId: existing.masterId,
    desiredDateKey: existing.dateKey,
  });

  const wasBlocking = isBlockingAppointmentStatus(existing.status);
  const willBeBlocking = isBlockingAppointmentStatus(desiredStatus);
  const allowAppointmentOverlap = resolveUpdateAllowAppointmentOverlap({
    allowAppointmentOverlapFlag,
    timingDirty,
    wasBlocking,
    willBeBlocking,
  });

  // Как в updateAppointment: conflict check только если итоговый статус blocking.
  if (!willBeBlocking) {
    const result = tryWrite(
      store,
      {
        id,
        startsAt: desiredStartsAt,
        endsAt: desiredFreeAt,
        breakAfterMinutes: existing.breakAfterMinutes,
        clientName: patch.clientName,
        clientPhone: patch.clientPhone,
        comment: patch.comment,
        importantNote: patch.importantNote,
        status: desiredStatus,
      },
      {
        excludeAppointmentId: id,
        allowAppointmentOverlap: false,
        skipConflictCheck: true,
      },
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    return { ok: true, record: result.record };
  }

  const result = tryWrite(
    store,
    {
      id,
      startsAt: desiredStartsAt,
      endsAt: desiredFreeAt,
      breakAfterMinutes: existing.breakAfterMinutes,
      clientName: patch.clientName,
      clientPhone: patch.clientPhone,
      comment: patch.comment,
      importantNote: patch.importantNote,
      status: desiredStatus,
    },
    {
      excludeAppointmentId: id,
      allowAppointmentOverlap,
    },
  );

  if (!result.ok) {
    return result;
  }
  return { ok: true, record: result.record };
}

function seedOverlappingPair(): {
  store: TestStore;
  firstId: string;
  secondId: string;
} {
  const store = emptyStore();
  const slot = {
    startsAt: at("14:00"),
    endsAt: at("15:00"),
    breakAfterMinutes: 0,
  };

  const first = tryWrite(
    store,
    { ...slot, clientName: "A", clientPhone: "+7111" },
    { allowAppointmentOverlap: false },
  );
  assert.equal(first.ok, true);
  assert.ok(first.ok);

  const secondBlocked = tryWrite(
    store,
    { ...slot, clientName: "B", clientPhone: "+7222" },
    { allowAppointmentOverlap: false },
  );
  assert.equal(secondBlocked.ok, false);
  assert.ok(!secondBlocked.ok);
  assert.equal(secondBlocked.code, "APPOINTMENT_OVERLAP");

  const second = tryWrite(
    store,
    { ...slot, clientName: "B", clientPhone: "+7222", comment: "overlap" },
    { allowAppointmentOverlap: true },
  );
  assert.equal(second.ok, true);
  assert.ok(second.ok);
  assert.equal(store.appointments.length, 2);

  return { store, firstId: first.id, secondId: second.id };
}

function testA_TwoExistingAppointmentsOverlap(): void {
  const { store } = seedOverlappingPair();
  assert.equal(store.appointments.length, 2);
  const [a, b] = store.appointments;
  assert.ok(a && b);
  assert.equal(a.startsAt.getTime(), b.startsAt.getTime());
  assert.equal(a.endsAt.getTime(), b.endsAt.getTime());
}

function testB_NonTimingPatchFirstPersists(): void {
  const { store, firstId } = seedOverlappingPair();
  const patched = patchAppointment(store, firstId, {
    clientPhone: "+7111-edited",
    comment: "note-a",
    importantNote: "master-a",
  });
  assert.equal(patched.ok, true);
  assert.ok(patched.ok);

  const reread = store.appointments.find((item) => item.id === firstId);
  assert.ok(reread);
  assert.equal(reread.clientPhone, "+7111-edited");
  assert.equal(reread.comment, "note-a");
  assert.equal(reread.importantNote, "master-a");
}

function testC_NonTimingPatchSecondPersists(): void {
  const { store, secondId } = seedOverlappingPair();
  const patched = patchAppointment(store, secondId, {
    clientName: "B-edited",
    clientPhone: "+7222-edited",
  });
  assert.equal(patched.ok, true);
  assert.ok(patched.ok);

  const reread = store.appointments.find((item) => item.id === secondId);
  assert.ok(reread);
  assert.equal(reread.clientName, "B-edited");
  assert.equal(reread.clientPhone, "+7222-edited");
}

function testD_RereadAfterCloseKeepsSavedFields(): void {
  const { store, firstId, secondId } = seedOverlappingPair();
  assert.equal(
    patchAppointment(store, firstId, { comment: "persist-a" }).ok,
    true,
  );
  assert.equal(
    patchAppointment(store, secondId, { comment: "persist-b" }).ok,
    true,
  );

  const again = structuredClone(store);
  assert.equal(
    again.appointments.find((item) => item.id === firstId)?.comment,
    "persist-a",
  );
  assert.equal(
    again.appointments.find((item) => item.id === secondId)?.comment,
    "persist-b",
  );
}

function testE_TimingChangeToOverlappingRequiresConfirm(): void {
  const { store, firstId } = seedOverlappingPair();

  const third = tryWrite(
    store,
    {
      startsAt: at("16:00"),
      endsAt: at("17:00"),
      clientName: "C",
      clientPhone: "+7333",
    },
    { allowAppointmentOverlap: false },
  );
  assert.equal(third.ok, true);

  const blocked = patchAppointment(
    store,
    firstId,
    { startsAt: at("16:00"), endsAt: at("17:00") },
    false,
  );
  assert.equal(blocked.ok, false);
  assert.ok(!blocked.ok);
  assert.equal(blocked.code, "APPOINTMENT_OVERLAP");

  const confirmed = patchAppointment(
    store,
    firstId,
    { startsAt: at("16:00"), endsAt: at("17:00") },
    true,
  );
  assert.equal(confirmed.ok, true);
  assert.ok(confirmed.ok);
  assert.equal(confirmed.record.startsAt.getTime(), at("16:00").getTime());
}

function testF_MoveToFreeSlotWithoutConfirm(): void {
  const { store, firstId } = seedOverlappingPair();
  const moved = patchAppointment(
    store,
    firstId,
    { startsAt: at("11:00"), endsAt: at("12:00") },
    false,
  );
  assert.equal(moved.ok, true);
  assert.ok(moved.ok);
  assert.equal(moved.record.startsAt.getTime(), at("11:00").getTime());
}

function testG_PatchDoesNotConflictWithSelf(): void {
  const store = emptyStore();
  const alone = tryWrite(
    store,
    {
      startsAt: at("10:00"),
      endsAt: at("11:00"),
      clientName: "Solo",
      clientPhone: "+7000",
    },
    { allowAppointmentOverlap: false },
  );
  assert.equal(alone.ok, true);
  assert.ok(alone.ok);

  const selfHit = tryWrite(
    store,
    { id: alone.id, startsAt: at("10:00"), endsAt: at("11:00") },
    { allowAppointmentOverlap: false },
  );
  assert.equal(selfHit.ok, false);

  const selfExcluded = tryWrite(
    store,
    {
      id: alone.id,
      startsAt: at("10:00"),
      endsAt: at("11:00"),
      clientPhone: "+7000-ok",
    },
    { excludeAppointmentId: alone.id, allowAppointmentOverlap: false },
  );
  assert.equal(selfExcluded.ok, true);

  const service = stripComments(read("src/services/AppointmentService.ts"));
  const updateStart = service.indexOf("export async function updateAppointment");
  const updateFn = service.slice(updateStart);
  assert.match(
    updateFn,
    /assertNoBlockingConflict\(\s*tx,\s*merged,\s*id/,
    "update передаёт id как excludeAppointmentId",
  );
}

function testH_PublicCreateStillForbidsOverlap(): void {
  const bookingService = stripComments(read("src/services/BookingService.ts"));
  const bookingRoute = stripComments(
    read("src/app/api/booking/create/route.ts"),
  );
  const appointmentService = stripComments(
    read("src/services/AppointmentService.ts"),
  );

  assert.doesNotMatch(bookingService, /allowAppointmentOverlap/);
  assert.doesNotMatch(bookingRoute, /allowAppointmentOverlap/);
  assert.doesNotMatch(
    appointmentService,
    /createOnlineAppointment[\s\S]{0,400}allowAppointmentOverlap:\s*true/,
  );

  const store = emptyStore();
  assert.equal(
    tryWrite(
      store,
      { startsAt: at("13:00"), endsAt: at("14:00") },
      { allowAppointmentOverlap: false },
    ).ok,
    true,
  );
  const publicBlocked = tryWrite(
    store,
    { startsAt: at("13:00"), endsAt: at("14:00") },
    { allowAppointmentOverlap: false },
  );
  assert.equal(publicBlocked.ok, false);
  assert.ok(!publicBlocked.ok);
  assert.equal(publicBlocked.code, "APPOINTMENT_OVERLAP");
}

function testI_MasterAccessDoesNotRegress(): void {
  assert.ok(!WRITE_SCHEDULE_ROLES.includes("MASTER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("OWNER"));
  assert.ok(WRITE_SCHEDULE_ROLES.includes("MANAGER"));

  const patchRoute = stripComments(
    read("src/app/api/appointments/[id]/route.ts"),
  );
  assert.match(patchRoute, /WRITE_SCHEDULE_ROLES/);
  assert.doesNotMatch(patchRoute, /INTERNAL_ROLES/);

  const roleCheck = stripComments(read("scripts/security-role-access-check.ts"));
  assert.match(roleCheck, /WRITE_SCHEDULE_ROLES/);
  assert.match(roleCheck, /FORBIDDEN_MASTER_APPOINTMENT_KEYS/);
  assert.match(roleCheck, /clientPhone/);
}

/** Review A: phone/comment без confirm на blocking overlap. */
function testReviewA_BlockingOverlapPhoneCommentWithoutConfirm(): void {
  const { store, firstId } = seedOverlappingPair();
  const patched = patchAppointment(store, firstId, {
    clientPhone: "+7111-review-a",
    comment: "review-a",
  });
  assert.equal(patched.ok, true);
  assert.ok(patched.ok);
  assert.equal(patched.record.clientPhone, "+7111-review-a");
  assert.equal(patched.record.comment, "review-a");
}

/** Review B: SCHEDULED → CONFIRMED без повторного confirm. */
function testReviewB_BlockingToBlockingStatusWithoutConfirm(): void {
  const { store, firstId } = seedOverlappingPair();
  const patched = patchAppointment(store, firstId, { status: "CONFIRMED" });
  assert.equal(patched.ok, true);
  assert.ok(patched.ok);
  assert.equal(patched.record.status, "CONFIRMED");
}

/**
 * Review C: RESCHEDULED пересекается с SCHEDULED —
 * comment ok; activate without override → overlap; with override → ok.
 */
function testReviewC_RescheduledActivationRequiresConfirm(): void {
  const store = emptyStore();
  const slot = {
    startsAt: at("14:00"),
    endsAt: at("15:00"),
    breakAfterMinutes: 0,
  };

  const active = tryWrite(
    store,
    { ...slot, clientName: "Active", clientPhone: "+7001" },
    { allowAppointmentOverlap: false },
  );
  assert.equal(active.ok, true);
  assert.ok(active.ok);

  // Исторический RESCHEDULED в том же слоте (не занимает слот при conflict check
  // через status, но в harness appointments всегда передаются — фильтруем
  // как MasterAvailability: non-blocking не дают appointment conflict).
  // Для реалистичности кладём RESCHEDULED напрямую и помечаем status.
  store.appointments.push({
    id: "rescheduled-1",
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    breakAfterMinutes: 0,
    status: "RESCHEDULED",
    clientName: "Moved",
    clientPhone: "+7002",
    comment: "was moved",
    importantNote: null,
    masterId: "m1",
    serviceId: "svc1",
    dateKey: DATE_KEY,
  });

  // Conflict check должен игнорировать non-blocking status в appointments.
  // MasterAvailabilityService filters via isBlockingAppointmentStatus.
  const commentOnly = patchAppointment(store, "rescheduled-1", {
    comment: "still rescheduled note",
  });
  assert.equal(commentOnly.ok, true);
  assert.ok(commentOnly.ok);
  assert.equal(commentOnly.record.status, "RESCHEDULED");
  assert.equal(commentOnly.record.comment, "still rescheduled note");

  const activateBlocked = patchAppointment(
    store,
    "rescheduled-1",
    { status: "SCHEDULED" },
    false,
  );
  assert.equal(activateBlocked.ok, false);
  assert.ok(!activateBlocked.ok);
  assert.equal(activateBlocked.code, "APPOINTMENT_OVERLAP");

  const activateConfirmed = patchAppointment(
    store,
    "rescheduled-1",
    { status: "SCHEDULED" },
    true,
  );
  assert.equal(activateConfirmed.ok, true);
  assert.ok(activateConfirmed.ok);
  assert.equal(activateConfirmed.record.status, "SCHEDULED");
}

/** Review D: blocking → RESCHEDULED без confirm, слот освобождается. */
function testReviewD_BlockingToRescheduledWithoutConfirm(): void {
  const { store, firstId, secondId } = seedOverlappingPair();
  const demoted = patchAppointment(store, firstId, { status: "RESCHEDULED" });
  assert.equal(demoted.ok, true);
  assert.ok(demoted.ok);
  assert.equal(demoted.record.status, "RESCHEDULED");

  // Исключая вторую (всё ещё blocking), остаётся только RESCHEDULED first —
  // non-blocking не занимает слот → новый кандидат проходит без override.
  const createOnFreedSlot = tryWrite(
    store,
    {
      startsAt: at("14:00"),
      endsAt: at("15:00"),
      clientName: "New",
      clientPhone: "+7999",
    },
    {
      allowAppointmentOverlap: false,
      excludeAppointmentId: secondId,
    },
  );
  assert.equal(createOnFreedSlot.ok, true);
}

/** Review E: block / full-day не обходятся override. */
function testReviewE_BlocksNotBypassedByOverride(): void {
  const store = emptyStore();
  store.scheduleBlocks.push({
    startsAt: at("14:00"),
    endsAt: at("15:00"),
    isFullDay: false,
  });

  const created = tryWrite(
    store,
    {
      startsAt: at("10:00"),
      endsAt: at("11:00"),
      clientName: "X",
      clientPhone: "+7010",
      status: "RESCHEDULED",
    },
    { allowAppointmentOverlap: true, skipConflictCheck: true },
  );
  assert.equal(created.ok, true);
  assert.ok(created.ok);

  const intoBlock = patchAppointment(
    store,
    created.id,
    {
      status: "SCHEDULED",
      startsAt: at("14:00"),
      endsAt: at("15:00"),
    },
    true,
  );
  assert.equal(intoBlock.ok, false);
  assert.ok(!intoBlock.ok);
  assert.equal(intoBlock.code, "SCHEDULE_BLOCK");

  const fullDayStore = emptyStore();
  fullDayStore.scheduleBlocks.push({
    startsAt: at("00:00"),
    endsAt: at("23:59"),
    isFullDay: true,
  });
  fullDayStore.appointments.push({
    id: "fd-1",
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    breakAfterMinutes: 0,
    status: "RESCHEDULED",
    clientName: "Y",
    clientPhone: "+7020",
    comment: null,
    importantNote: null,
    masterId: "m1",
    serviceId: "svc1",
    dateKey: DATE_KEY,
  });

  const intoFullDay = patchAppointment(
    fullDayStore,
    "fd-1",
    { status: "SCHEDULED" },
    true,
  );
  assert.equal(intoFullDay.ok, false);
  assert.ok(!intoFullDay.ok);
  assert.equal(intoFullDay.code, "FULL_DAY_BLOCK");
}

function testAllowFormulaRejectsActivationWithoutFlag(): void {
  assert.equal(
    resolveUpdateAllowAppointmentOverlap({
      allowAppointmentOverlapFlag: false,
      timingDirty: false,
      wasBlocking: false,
      willBeBlocking: true,
    }),
    false,
    "активация blocking без флага не auto-allow",
  );
  assert.equal(
    resolveUpdateAllowAppointmentOverlap({
      allowAppointmentOverlapFlag: false,
      timingDirty: false,
      wasBlocking: true,
      willBeBlocking: true,
    }),
    true,
    "уже blocking + !timingDirty → auto-allow",
  );
  assert.equal(
    resolveUpdateAllowAppointmentOverlap({
      allowAppointmentOverlapFlag: false,
      timingDirty: true,
      wasBlocking: true,
      willBeBlocking: true,
    }),
    false,
    "timing change без флага не auto-allow",
  );
  assert.equal(
    resolveUpdateAllowAppointmentOverlap({
      allowAppointmentOverlapFlag: true,
      timingDirty: true,
      wasBlocking: false,
      willBeBlocking: true,
    }),
    true,
    "явный флаг разрешает",
  );
}

function testServiceAndUiWiring(): void {
  const service = stripComments(read("src/services/AppointmentService.ts"));
  const updateStart = service.indexOf("export async function updateAppointment");
  assert.ok(updateStart >= 0);
  const updateFn = service.slice(updateStart);

  assert.match(updateFn, /const wasBlocking = isBlockingAppointmentStatus\(existing\.status\)/);
  assert.match(updateFn, /const willBeBlocking = needsConflictCheck/);
  assert.match(
    updateFn,
    /options\?\.allowAppointmentOverlap === true\s*\|\|\s*\(!timingDirty && wasBlocking && willBeBlocking\)/,
  );
  assert.doesNotMatch(
    updateFn,
    /options\?\.allowAppointmentOverlap === true \|\| !timingDirty;/,
    "старая небезопасная формула только по !timingDirty не должна вернуться",
  );

  const form = stripComments(
    read("src/components/schedule/appointment-editor-form.tsx"),
  );
  assert.match(form, /Сохранить всё равно/);
  assert.match(
    form,
    /payload\.code === "APPOINTMENT_OVERLAP" &&\s*!allowAppointmentOverlap/,
  );
  assert.match(form, /payloadBody\.allowAppointmentOverlap = true/);
}

function main(): void {
  testA_TwoExistingAppointmentsOverlap();
  testB_NonTimingPatchFirstPersists();
  testC_NonTimingPatchSecondPersists();
  testD_RereadAfterCloseKeepsSavedFields();
  testE_TimingChangeToOverlappingRequiresConfirm();
  testF_MoveToFreeSlotWithoutConfirm();
  testG_PatchDoesNotConflictWithSelf();
  testH_PublicCreateStillForbidsOverlap();
  testI_MasterAccessDoesNotRegress();
  testReviewA_BlockingOverlapPhoneCommentWithoutConfirm();
  testReviewB_BlockingToBlockingStatusWithoutConfirm();
  testReviewC_RescheduledActivationRequiresConfirm();
  testReviewD_BlockingToRescheduledWithoutConfirm();
  testReviewE_BlocksNotBypassedByOverride();
  testAllowFormulaRejectsActivationWithoutFlag();
  testServiceAndUiWiring();
  console.log("security-appointment-overlap-edit-check: OK");
}

main();
