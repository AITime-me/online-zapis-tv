/**
 * Регрессия: редактирование уже пересекающихся записей.
 *
 * A–G: in-memory harness (та же логика конфликтов, что AppointmentService).
 * H–I: статический аудит публичного booking и MASTER access.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AppointmentStatus } from "@prisma/client";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { isAppointmentTimingDirty } from "../src/lib/schedule/appointment-timing-write";
import { resolveAppointmentWriteConflict } from "../src/lib/schedule/appointment-write-conflicts";
import {
  WRITE_SCHEDULE_ROLES,
} from "../src/lib/auth/api-access";
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

type TestStore = {
  appointments: StoredAppointment[];
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
  },
  options: {
    excludeAppointmentId?: string;
    allowAppointmentOverlap: boolean;
  },
):
  | { ok: true; id: string; record: StoredAppointment }
  | { ok: false; code: string } {
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
    scheduleBlocks: [],
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

  if (candidate.id) {
    const index = store.appointments.findIndex((item) => item.id === candidate.id);
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
    status: "SCHEDULED",
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

/**
 * Сервисная семантика updateAppointment:
 * allow = explicit flag OR !timingDirty.
 */
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
  },
  allowAppointmentOverlapFlag = false,
):
  | { ok: true; record: StoredAppointment }
  | { ok: false; code: string } {
  const existing = store.appointments.find((item) => item.id === id);
  assert.ok(existing, "запись для PATCH должна существовать");

  const desiredStartsAt = patch.startsAt ?? existing.startsAt;
  const desiredFreeAt = patch.endsAt ?? existing.endsAt;

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

  const allowAppointmentOverlap =
    allowAppointmentOverlapFlag === true || !timingDirty;

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
  const store: TestStore = { appointments: [] };
  const slot = {
    startsAt: at("14:00"),
    endsAt: at("15:00"),
    breakAfterMinutes: 0,
  };

  const first = tryWrite(store, { ...slot, clientName: "A", clientPhone: "+7111" }, {
    allowAppointmentOverlap: false,
  });
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

  // «закрытие / повторное открытие» = новый GET из store
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

  // Перенос первой на другой слот, где уже есть третья запись → overlap.
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
  const store: TestStore = { appointments: [] };
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

  // Тот же интервал без exclude → self-conflict.
  const selfHit = tryWrite(
    store,
    { id: alone.id, startsAt: at("10:00"), endsAt: at("11:00") },
    { allowAppointmentOverlap: false },
  );
  assert.equal(selfHit.ok, false);

  // С excludeAppointmentId (как в updateAppointment) — ок.
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

  const store: TestStore = { appointments: [] };
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

function testServiceAndUiWiring(): void {
  const service = stripComments(read("src/services/AppointmentService.ts"));
  assert.match(
    service,
    /const allowAppointmentOverlap =\s*options\?\.allowAppointmentOverlap === true \|\| !timingDirty/,
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
  testServiceAndUiWiring();
  console.log("security-appointment-overlap-edit-check: OK");
}

main();
