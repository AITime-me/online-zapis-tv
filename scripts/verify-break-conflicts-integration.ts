/**
 * Интеграционная проверка конфликтов с перерывом через AppointmentService.
 * Usage: npx tsx scripts/verify-break-conflicts-integration.ts
 */

import { prisma } from "../src/lib/db";
import { getStudioTodayRange } from "../src/lib/datetime/studio";
import {
  AppointmentConflictError,
  createAppointment,
} from "../src/services/AppointmentService";
import { listBookableServicesForMaster } from "../src/services/ScheduleEditorOptionsService";

async function main() {
  const master = await prisma.master.findFirst({
    where: { internalName: { contains: "Ксения" } },
  });
  if (!master) {
    throw new Error("Мастер Ксения не найден");
  }

  const service = (await listBookableServicesForMaster(master.id)).find((item) =>
    item.publicName.includes("Буккальный массаж лица"),
  );
  if (!service) {
    throw new Error("Услуга «Буккальный массаж лица» не найдена");
  }

  if (service.durationMinutes !== 60) {
    throw new Error(`Ожидалась длительность 60, получено ${service.durationMinutes}`);
  }

  const user = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!user) {
    throw new Error("Пользователь OWNER не найден");
  }

  const dateKey = getStudioTodayRange().dateKey;
  const createdIds: string[] = [];

  try {
    const first = await createAppointment(
      {
        masterId: master.id,
        dateKey,
        startTime: "10:00",
        endTime: "11:00",
        serviceId: service.id,
        clientName: "Test Break Conflict",
        clientPhone: "+79990000001",
        status: "SCHEDULED",
        source: "INTERNAL",
      },
      user.id,
    );
    createdIds.push(first.appointment.id);

    const stored = await prisma.appointment.findUnique({
      where: { id: first.id },
      select: { breakAfterMinutes: true },
    });
    if ((stored?.breakAfterMinutes ?? 0) <= 0) {
      throw new Error("breakAfterMinutes не сохранился у первой записи");
    }

    let conflictAt1100 = false;
    try {
      await createAppointment(
        {
          masterId: master.id,
          dateKey,
          startTime: "11:00",
          endTime: "11:30",
          serviceId: service.id,
          clientName: "Test Break Conflict 2",
          clientPhone: "+79990000002",
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        user.id,
      );
    } catch (error) {
      conflictAt1100 = error instanceof AppointmentConflictError;
    }

    if (!conflictAt1100) {
      throw new Error("Запись на 11:00 должна была конфликтовать");
    }

    const second = await createAppointment(
      {
        masterId: master.id,
        dateKey,
        startTime: "11:15",
        endTime: "12:15",
        serviceId: service.id,
        clientName: "Test Break Conflict 3",
        clientPhone: "+79990000003",
        status: "SCHEDULED",
        source: "INTERNAL",
      },
      user.id,
    );
    createdIds.push(second.appointment.id);

    console.log("OK: integration break conflict checks passed");
    console.log(`  service duration=${service.durationMinutes}, break=${service.breakAfterMinutes}`);
    console.log("  11:00 blocked, 11:15 allowed");
  } finally {
    if (createdIds.length > 0) {
      await prisma.appointment.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
