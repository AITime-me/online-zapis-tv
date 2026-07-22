/**
 * Регрессия: allowAppointmentOverlap не одноразовый —
 * A→B→C→D с одинаковым интервалом после отдельного confirm каждой записи.
 *
 * Основной harness: in-memory store + checkMasterIntervalAvailability +
 * resolveAppointmentWriteConflict (та же сервисная логика конфликтов).
 * Опционально: реальный createAppointment через Prisma, если БД доступна.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AppointmentStatus } from "@prisma/client";
import { parseStudioDateKey } from "../src/lib/datetime/date-layer";
import { resolveAppointmentWriteConflict } from "../src/lib/schedule/appointment-write-conflicts";
import {
  checkMasterIntervalAvailability,
  type BusyInterval,
} from "../src/services/MasterAvailabilityService";

const ROOT = process.cwd();
const DATE_KEY = "2099-06-15";
const SLOT = { startTime: "14:00", endTime: "15:00" } as const;

type StoredAppointment = BusyInterval & {
  id: string;
  status: AppointmentStatus;
};

type TestStore = {
  appointments: StoredAppointment[];
  scheduleBlocks: Array<{
    startsAt: Date;
    endsAt: Date;
    isFullDay?: boolean;
  }>;
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

function assertPublicBookingIsolated(): void {
  const bookingService = stripComments(read("src/services/BookingService.ts"));
  const bookingRoute = stripComments(
    read("src/app/api/booking/create/route.ts"),
  );
  assert.doesNotMatch(bookingService, /allowAppointmentOverlap/);
  assert.doesNotMatch(bookingRoute, /allowAppointmentOverlap/);
  assert.doesNotMatch(
    stripComments(read("src/services/AppointmentService.ts")),
    /createOnlineAppointment[\s\S]{0,400}allowAppointmentOverlap:\s*true/,
  );
}

function tryCreateInStore(
  store: TestStore,
  candidate: { startsAt: Date; endsAt: Date; breakAfterMinutes?: number },
  allowAppointmentOverlap: boolean,
): { ok: true; id: string } | { ok: false; code: string } {
  const availability = checkMasterIntervalAvailability({
    masterId: "m1",
    dateKey: DATE_KEY,
    standardWorkStart: "09:00",
    standardWorkEnd: "20:00",
    constrainAppointmentEnd: true,
    extraWorkWindows: [],
    appointments: store.appointments,
    scheduleBlocks: store.scheduleBlocks,
    candidateInterval: {
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      breakAfterMinutes: candidate.breakAfterMinutes ?? 0,
    },
  });

  const blocking = resolveAppointmentWriteConflict(
    availability.conflicts,
    allowAppointmentOverlap,
  );
  if (blocking) {
    return { ok: false, code: blocking.code };
  }

  const id = `appt-${store.appointments.length + 1}`;
  store.appointments.push({
    id,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    breakAfterMinutes: candidate.breakAfterMinutes ?? 0,
    status: "SCHEDULED",
  });
  return { ok: true, id };
}

function testRepeatedOverlapsInMemoryStore(): void {
  const store: TestStore = { appointments: [], scheduleBlocks: [] };
  const sameSlot = {
    startsAt: at(SLOT.startTime),
    endsAt: at(SLOT.endTime),
    breakAfterMinutes: 15,
  };

  // A
  const a = tryCreateInStore(store, sameSlot, false);
  assert.equal(a.ok, true);
  assert.equal(store.appointments.length, 1);

  // B без флага
  const bBlocked = tryCreateInStore(store, sameSlot, false);
  assert.deepEqual(bBlocked, { ok: false, code: "APPOINTMENT_OVERLAP" });
  assert.equal(store.appointments.length, 1);

  // B с флагом
  const b = tryCreateInStore(store, sameSlot, true);
  assert.equal(b.ok, true);
  assert.equal(store.appointments.length, 2);

  // C без флага после A+B — снова overlap (не одноразово)
  const cBlocked = tryCreateInStore(store, sameSlot, false);
  assert.deepEqual(cBlocked, { ok: false, code: "APPOINTMENT_OVERLAP" });
  assert.equal(store.appointments.length, 2);

  const c = tryCreateInStore(store, sameSlot, true);
  assert.equal(c.ok, true);
  assert.equal(store.appointments.length, 3);

  // D
  const dBlocked = tryCreateInStore(store, sameSlot, false);
  assert.deepEqual(dBlocked, { ok: false, code: "APPOINTMENT_OVERLAP" });
  const d = tryCreateInStore(store, sameSlot, true);
  assert.equal(d.ok, true);
  assert.equal(store.appointments.length, 4);

  // Все четыре с одинаковым master/start/end
  assert.ok(
    store.appointments.every(
      (row) =>
        row.startsAt.getTime() === sameSlot.startsAt.getTime() &&
        row.endsAt.getTime() === sameSlot.endsAt.getTime(),
    ),
  );
  assert.deepEqual(
    store.appointments.map((row) => row.id),
    ["appt-1", "appt-2", "appt-3", "appt-4"],
  );

  // Interval ScheduleBlock при нескольких appointments
  store.scheduleBlocks = [
    { startsAt: at("16:00"), endsAt: at("16:30"), isFullDay: false },
  ];
  const blockDenied = tryCreateInStore(
    store,
    { startsAt: at("16:00"), endsAt: at("16:30") },
    true,
  );
  assert.deepEqual(blockDenied, { ok: false, code: "SCHEDULE_BLOCK" });

  // Full-day block
  store.scheduleBlocks = [
    { startsAt: at("00:00"), endsAt: at("23:59"), isFullDay: true },
  ];
  const fullDayDenied = tryCreateInStore(
    store,
    { startsAt: at("17:00"), endsAt: at("17:30") },
    true,
  );
  assert.deepEqual(fullDayDenied, { ok: false, code: "FULL_DAY_BLOCK" });
  assert.equal(store.appointments.length, 4, "блоки не должны добавлять записи");
}

async function tryPrismaIntegration(): Promise<"ok" | "skipped"> {
  let prisma: typeof import("../src/lib/db").prisma;
  try {
    ({ prisma } = await import("../src/lib/db"));
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log(
      "security-appointment-repeated-overlap-check: Prisma DB unreachable — in-memory harness only",
    );
    return "skipped";
  }

  const nodeRequire = createRequire(__filename);
  const Module = nodeRequire("module") as typeof import("module") & {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = Module._load.bind(Module);
  Module._load = (request, parent, isMain) => {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

  const { AppointmentConflictError, createAppointment } = await import(
    "../src/services/AppointmentService"
  );
  const { listBookableServicesForMaster } = await import(
    "../src/services/ScheduleEditorOptionsService"
  );
  const { getStudioDayRangeFromDateKey } = await import(
    "../src/lib/datetime/studio"
  );

  const master = await prisma.master.findFirst({
    where: { isActive: true },
    orderBy: { internalName: "asc" },
  });
  if (!master) {
    console.log("no active master — skip prisma integration");
    await prisma.$disconnect();
    return "skipped";
  }

  const service = (await listBookableServicesForMaster(master.id))[0];
  const user = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!service || !user) {
    console.log("missing service/OWNER — skip prisma integration");
    await prisma.$disconnect();
    return "skipped";
  }

  const baseInput = {
    masterId: master.id,
    dateKey: DATE_KEY,
    startTime: SLOT.startTime,
    endTime: SLOT.endTime,
    serviceId: service.id,
    status: "SCHEDULED" as const,
    source: "INTERNAL" as const,
  };

  const createdIds: string[] = [];
  const blockIds: string[] = [];

  try {
    const a = await createAppointment(
      {
        ...baseInput,
        clientName: "Repeated Overlap A",
        clientPhone: "+79990000101",
      },
      user.id,
    );
    createdIds.push(a.id);

    try {
      await createAppointment(
        {
          ...baseInput,
          clientName: "Repeated Overlap B blocked",
          clientPhone: "+79990000102",
        },
        user.id,
      );
      assert.fail("expected APPOINTMENT_OVERLAP");
    } catch (error) {
      assert.ok(error instanceof AppointmentConflictError);
      assert.equal(error.code, "APPOINTMENT_OVERLAP");
    }

    const b = await createAppointment(
      {
        ...baseInput,
        clientName: "Repeated Overlap B",
        clientPhone: "+79990000102",
      },
      user.id,
      { allowAppointmentOverlap: true },
    );
    createdIds.push(b.id);

    try {
      await createAppointment(
        {
          ...baseInput,
          clientName: "Repeated Overlap C blocked",
          clientPhone: "+79990000103",
        },
        user.id,
      );
      assert.fail("expected APPOINTMENT_OVERLAP after A+B");
    } catch (error) {
      assert.ok(error instanceof AppointmentConflictError);
      assert.equal(error.code, "APPOINTMENT_OVERLAP");
    }

    const c = await createAppointment(
      {
        ...baseInput,
        clientName: "Repeated Overlap C",
        clientPhone: "+79990000103",
      },
      user.id,
      { allowAppointmentOverlap: true },
    );
    createdIds.push(c.id);

    const d = await createAppointment(
      {
        ...baseInput,
        clientName: "Repeated Overlap D",
        clientPhone: "+79990000104",
      },
      user.id,
      { allowAppointmentOverlap: true },
    );
    createdIds.push(d.id);

    const stored = await prisma.appointment.findMany({
      where: { id: { in: createdIds } },
    });
    assert.equal(stored.length, 4);

    const intervalBlock = await prisma.scheduleBlock.create({
      data: {
        masterId: master.id,
        blockType: "BREAK",
        isFullDay: false,
        startsAt: at("16:00"),
        endsAt: at("16:30"),
        internalReason: "repeated-overlap-test-interval",
      },
    });
    blockIds.push(intervalBlock.id);

    try {
      await createAppointment(
        {
          ...baseInput,
          startTime: "16:00",
          endTime: "16:30",
          clientName: "Block should win",
          clientPhone: "+79990000105",
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      assert.fail("expected SCHEDULE_BLOCK");
    } catch (error) {
      assert.ok(error instanceof AppointmentConflictError);
      assert.equal(error.code, "SCHEDULE_BLOCK");
    }

    const { noteDate } = getStudioDayRangeFromDateKey(DATE_KEY);
    const fullDay = await prisma.scheduleBlock.create({
      data: {
        masterId: master.id,
        blockType: "DAY_OFF",
        isFullDay: true,
        blockDate: noteDate,
        internalReason: "repeated-overlap-test-fullday",
      },
    });
    blockIds.push(fullDay.id);

    try {
      await createAppointment(
        {
          ...baseInput,
          startTime: "17:00",
          endTime: "17:30",
          clientName: "Full day should win",
          clientPhone: "+79990000106",
        },
        user.id,
        { allowAppointmentOverlap: true },
      );
      assert.fail("expected FULL_DAY_BLOCK");
    } catch (error) {
      assert.ok(error instanceof AppointmentConflictError);
      assert.equal(error.code, "FULL_DAY_BLOCK");
    }
  } finally {
    if (createdIds.length > 0) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (blockIds.length > 0) {
      await prisma.scheduleBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.$disconnect();
  }

  return "ok";
}

async function main(): Promise<void> {
  assertPublicBookingIsolated();
  testRepeatedOverlapsInMemoryStore();
  const prismaResult = await tryPrismaIntegration();
  console.log(
    `security-appointment-repeated-overlap-check: OK (prisma=${prismaResult})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
