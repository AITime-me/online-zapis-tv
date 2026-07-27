import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { prisma } from "../src/lib/db";
import { scheduleLoadOptionsForRole } from "../src/lib/schedule/schedule-load-options";
import {
  FORBIDDEN_MASTER_APPOINTMENT_KEYS,
} from "../src/lib/schedule/appointment-contract";

// In plain Node tests `server-only` always throws; stub it so we can execute services.
const require = createRequire(
  `${process.cwd()}/scripts/schedule-master-note-runtime-check.ts`,
);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
};

const dateKey = "2026-07-03";
const monthKey = "2026-07";

const masterA = "master-a";
const masterB = "master-b";

const apptA = "appt-a";
const apptB = "appt-b";
const apptNull = "appt-null";
const apptEmpty = "appt-empty";
const apptWhitespace = "appt-ws";

const noteA = "VIP (мастер А)";
const noteB = "VIP (мастер Б)";

function buildAppointment({
  id,
  masterId,
  startsAt,
  endsAt,
  importantNote,
}: {
  id: string;
  masterId: string;
  startsAt: string;
  endsAt: string;
  importantNote: string | null;
}) {
  return {
    id,
    masterId,
    serviceId: "service-1",
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    timingSemanticsVersion: 1,
    breakAfterMinutes: 0,
    standardBreakAfterMinutes: 0,
    standardDurationMinutes: 60,
    standardBreakAfterMinutesLegacy: 0,
    isManualTimeOverride: false,
    isBold: false,
    status: "CONFIRMED",
    source: "INTERNAL",
    promoCode: null,
    appliedPromotions: [],
    manageToken: null,
    manageTokenHash: null,
    cancelledBy: null,
    cancelReason: null,
    rescheduleRequestText: null,
    rescheduleRequestedAt: null,
    createdByUserId: null,
    clientId: "client-1",
    clientName: "Клиент",
    clientPhone: "+79001234567",
    comment: "secret comment",
    importantNote,
    timingCanonicalStoredAt: null,
    statusCode: "CONFIRMED",
    sourceCode: "INTERNAL",
    cancelledAt: null,
    createdAt: new Date(startsAt),
    updatedAt: new Date(startsAt),
    botSessionId: null,
    isManualTimeOverrideLegacy: false,
    service: { publicName: "Услуга" },
  } satisfies Record<string, unknown>;
}

async function run(): Promise<void> {
  const { getScheduleDayData } = await import(
    "../src/services/ScheduleDayService"
  );
  const { getScheduleMonthData } = await import(
    "../src/services/ScheduleMonthService"
  );

  // Save originals and stub prisma in-memory.
  const originalMasterFindMany = prisma.master.findMany.bind(prisma.master);
  const originalManagerNoteFindMany = prisma.managerNote.findMany.bind(prisma.managerNote);
  const originalExtraWorkWindowFindMany = prisma.extraWorkWindow.findMany.bind(prisma.extraWorkWindow);
  const originalBookingRequestFindMany = prisma.bookingRequest.findMany.bind(prisma.bookingRequest);

  const prismaMutable = prisma as unknown as {
    appointment?: { findMany: (...args: unknown[]) => Promise<unknown[]> };
    scheduleBlock?: { findMany: (...args: unknown[]) => Promise<unknown[]> };
    master: { findMany: (...args: unknown[]) => Promise<unknown[]> };
    managerNote: { findMany: (...args: unknown[]) => Promise<unknown[]> };
    extraWorkWindow: { findMany: (...args: unknown[]) => Promise<unknown[]> };
    bookingRequest: { findMany: (...args: unknown[]) => Promise<unknown[]> };
  };

  const originalAppointmentFindMany = prismaMutable.appointment?.findMany;
  const originalScheduleBlockFindMany = prismaMutable.scheduleBlock?.findMany;

  try {
    const appointments = [
      buildAppointment({
        id: apptA,
        masterId: masterA,
        startsAt: "2026-07-03T09:00:00.000Z",
        endsAt: "2026-07-03T10:00:00.000Z",
        importantNote: noteA,
      }),
      buildAppointment({
        id: apptB,
        masterId: masterB,
        startsAt: "2026-07-03T15:30:00.000Z",
        endsAt: "2026-07-03T16:30:00.000Z",
        importantNote: noteB,
      }),
      buildAppointment({
        id: apptNull,
        masterId: masterA,
        startsAt: "2026-07-03T11:00:00.000Z",
        endsAt: "2026-07-03T11:30:00.000Z",
        importantNote: null,
      }),
      buildAppointment({
        id: apptEmpty,
        masterId: masterB,
        startsAt: "2026-07-03T12:00:00.000Z",
        endsAt: "2026-07-03T12:30:00.000Z",
        importantNote: "",
      }),
      buildAppointment({
        id: apptWhitespace,
        masterId: masterA,
        startsAt: "2026-07-03T13:00:00.000Z",
        endsAt: "2026-07-03T13:30:00.000Z",
        importantNote: "   ",
      }),
    ];

    const mastersWithRelations = [
      {
        id: masterA,
        internalName: "Мастер A",
        publicName: "МA",
        appointments: appointments.filter((a) => a.masterId === masterA),
        scheduleBlocks: [],
      },
      {
        id: masterB,
        internalName: "Мастер B",
        publicName: "МB",
        appointments: appointments.filter((a) => a.masterId === masterB),
        scheduleBlocks: [],
      },
    ];

    // Day/Month services load appointments and blocks via different Prisma APIs.
    prismaMutable.master.findMany = async () => mastersWithRelations as unknown[];
    prismaMutable.managerNote.findMany = async () => [];
    prismaMutable.extraWorkWindow.findMany = async () => [];
    prismaMutable.bookingRequest.findMany = async () => [];
    if (originalAppointmentFindMany) {
      prismaMutable.appointment!.findMany = async () => appointments as unknown[];
    }
    if (originalScheduleBlockFindMany) {
      prismaMutable.scheduleBlock!.findMany = async () => [];
    }

    const masterOptions = scheduleLoadOptionsForRole("MASTER");
    assert.equal(masterOptions.appointmentVisibility, "master");

    // Simulate two MASTER sessions: options are role-based, not master-id-based.
    const dayPayload1 = await getScheduleDayData(dateKey, masterOptions);
    const dayPayload2 = await getScheduleDayData(dateKey, masterOptions);

    function collectNotesFromDay(payload: Awaited<ReturnType<typeof getScheduleDayData>>) {
      const byApptId = new Map<string, string | null>();
      for (const m of payload.masters) {
        for (const appt of m.appointments as Array<Record<string, unknown>>) {
          assert.ok("masterNote" in appt, "MASTER DTO must include masterNote");
          for (const forbiddenKey of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
            assert.ok(
              !(forbiddenKey in appt),
              `MASTER DTO must not expose ${forbiddenKey}`,
            );
          }
          const masterNoteVal = (appt as Record<string, unknown>).masterNote;
          byApptId.set(
            String((appt as Record<string, unknown>).id),
            typeof masterNoteVal === "string" || masterNoteVal === null
              ? (masterNoteVal as string | null)
              : null,
          );
        }
      }
      return byApptId;
    }

    const dayNotes1 = collectNotesFromDay(dayPayload1);
    const dayNotes2 = collectNotesFromDay(dayPayload2);
    assert.deepEqual([...dayNotes1.entries()], [...dayNotes2.entries()]);

    const firstMasterAppt = dayPayload1.masters
      .flatMap((m) => m.appointments)
      .find((a) => String((a as Record<string, unknown>).id) === apptA);
    assert.ok(firstMasterAppt, "MASTER DTO appt-a must exist");
    const masterApptKeys = Object.keys(firstMasterAppt as Record<string, unknown>).sort();
    console.log("master-DTO keys (appt-a):", masterApptKeys);

    assert.equal(dayNotes1.get(apptA), noteA);
    assert.equal(dayNotes1.get(apptB), noteB);
    assert.equal(dayNotes1.get(apptNull), null);
    assert.equal(dayNotes1.get(apptEmpty), null);
    assert.equal(dayNotes1.get(apptWhitespace), null);

    const monthPayload = await getScheduleMonthData(monthKey, masterOptions);
    function collectNotesFromMonth(payload: Awaited<ReturnType<typeof getScheduleMonthData>>) {
      const byApptId = new Map<string, string | null>();
      for (const day of payload.days) {
        for (const masterId of Object.keys(day.masterCells)) {
          for (const item of day.masterCells[masterId] ?? []) {
            if (item.kind !== "appointment") continue;
            const appt = item as unknown as Record<string, unknown>;
            assert.ok("masterNote" in appt);
            for (const forbiddenKey of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
              assert.ok(!(forbiddenKey in appt), `MASTER month DTO must not expose ${forbiddenKey}`);
            }
            const masterNoteVal = appt.masterNote;
            byApptId.set(
              String(appt.id),
              typeof masterNoteVal === "string" || masterNoteVal === null
                ? (masterNoteVal as string | null)
                : null,
            );
          }
        }
      }
      return byApptId;
    }

    const monthNotes = collectNotesFromMonth(monthPayload);

    // Day/month should match for the same fixture appointments.
    assert.deepEqual(apptIds(dayNotes1), apptIds(monthNotes));
    assert.equal(monthNotes.get(apptA), noteA);
    assert.equal(monthNotes.get(apptB), noteB);
    assert.equal(monthNotes.get(apptNull), null);
    assert.equal(monthNotes.get(apptEmpty), null);
    assert.equal(monthNotes.get(apptWhitespace), null);

    // OWNER/MANAGER: operational DTO with importantNote (not masterNote).
    const ownerOptions = scheduleLoadOptionsForRole("OWNER");
    const ownerDay = await getScheduleDayData(dateKey, ownerOptions);
    for (const m of ownerDay.masters) {
      for (const appt of m.appointments as Array<Record<string, unknown>>) {
        assert.ok("importantNote" in appt, "OWNER DTO must include importantNote");
        assert.ok(!("masterNote" in appt), "OWNER DTO must not include masterNote");
        assert.ok("clientPhone" in appt, "OWNER DTO must include phone");
        assert.ok("comment" in appt, "OWNER DTO must include comment");
      }
    }

    // MASTER must remain non-operational (no client override in options object).
    assert.equal(scheduleLoadOptionsForRole("MASTER").appointmentVisibility, "master");

    console.log("schedule-master-note-runtime-check: all assertions passed");
  } finally {
    // Restore prisma methods.
    prismaMutable.master.findMany = originalMasterFindMany;
    prismaMutable.managerNote.findMany = originalManagerNoteFindMany;
    prismaMutable.extraWorkWindow.findMany = originalExtraWorkWindowFindMany;
    prismaMutable.bookingRequest.findMany = originalBookingRequestFindMany;
    if (originalAppointmentFindMany) {
      prismaMutable.appointment!.findMany = originalAppointmentFindMany;
    }
    if (originalScheduleBlockFindMany) {
      prismaMutable.scheduleBlock!.findMany = originalScheduleBlockFindMany;
    }
  }
}

function apptIds(byId: Map<string, unknown>) {
  return [...byId.keys()].sort();
}

void run();

