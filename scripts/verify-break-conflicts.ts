/**
 * Проверка учёта breakAfterMinutes в конфликтах записей.
 *
 * Usage: npx tsx scripts/verify-break-conflicts.ts
 */

import {
  checkMasterIntervalAvailability,
  toBusyInterval,
} from "../src/services/MasterAvailabilityService";

const dateKey = "2026-07-03";

function at(time: string): Date {
  return new Date(`${dateKey}T${time}:00+05:00`);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasAppointmentConflict(
  existing: {
    startsAt: Date;
    endsAt: Date;
    breakAfterMinutes: number;
  },
  candidate: {
    startsAt: Date;
    endsAt: Date;
    breakAfterMinutes: number;
  },
): boolean {
  const result = checkMasterIntervalAvailability({
    masterId: "master",
    dateKey,
    standardWorkStart: "09:00",
    standardWorkEnd: "21:00",
    extraWorkWindows: [],
    scheduleBlocks: [],
    appointments: [
      {
        ...existing,
        status: "SCHEDULED",
      },
    ],
    candidateInterval: candidate,
  });

  return result.conflicts.some((conflict) => conflict.type === "appointment");
}

function main() {
  const existing = {
    startsAt: at("10:00"),
    endsAt: at("11:00"),
    breakAfterMinutes: 15,
  };

  assert(
    toBusyInterval(existing).endsAt.getTime() === at("11:15").getTime(),
    "busyEnd должен быть 11:15",
  );

  assert(
    hasAppointmentConflict(existing, {
      startsAt: at("11:00"),
      endsAt: at("11:30"),
      breakAfterMinutes: 15,
    }),
    "11:00 должно конфликтовать из-за перерыва до 11:15",
  );

  assert(
    !hasAppointmentConflict(existing, {
      startsAt: at("11:15"),
      endsAt: at("12:00"),
      breakAfterMinutes: 15,
    }),
    "11:15 должно быть свободно",
  );

  assert(
    hasAppointmentConflict(existing, {
      startsAt: at("11:00"),
      endsAt: at("11:30"),
      breakAfterMinutes: 0,
    }),
    "11:00 должно конфликтовать даже если у новой записи break=0",
  );

  // Кандидат 09:45-10:15 конфликтует с началом процедуры 10:00
  assert(
    hasAppointmentConflict(existing, {
      startsAt: at("09:45"),
      endsAt: at("10:15"),
      breakAfterMinutes: 0,
    }),
    "пересечение с началом процедуры должно конфликтовать",
  );

  // Редактирование: та же запись исключается на уровне AppointmentService,
  // здесь проверяем только расширение busy-интервала.
  assert(
    !hasAppointmentConflict(
      {
        startsAt: at("10:00"),
        endsAt: at("11:00"),
        breakAfterMinutes: 0,
      },
      {
        startsAt: at("11:00"),
        endsAt: at("12:00"),
        breakAfterMinutes: 0,
      },
    ),
    "без перерыва 11:00 должно быть свободно",
  );

  console.log("OK: break conflict checks passed");
}

main();
