import { prisma } from "@/lib/db";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";

export async function getScheduleEditorOptions(masterId: string) {
  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: {
      id: true,
      workStart: true,
      workEnd: true,
    },
  });

  if (!master) {
    return null;
  }

  const masterServices = await prisma.masterService.findMany({
    where: {
      masterId,
      isEnabled: true,
      service: { isActive: true },
    },
    include: {
      service: {
        select: {
          id: true,
          publicName: true,
          durationMinutes: true,
          breakAfterMinutes: true,
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const services = await Promise.all(
    masterServices.map(async (entry) => {
      const timing = await resolveServiceTimingForMaster(
        masterId,
        entry.serviceId,
      );

      return {
        id: entry.serviceId,
        publicName: entry.service.publicName,
        durationMinutes:
          timing?.durationMinutes ?? entry.service.durationMinutes,
        breakAfterMinutes:
          timing?.breakAfterMinutes ?? entry.service.breakAfterMinutes,
        totalBusyMinutes:
          timing?.totalBusyMinutes ??
          entry.service.durationMinutes + entry.service.breakAfterMinutes,
      };
    }),
  );

  return {
    master: {
      workStart: master.workStart,
      workEnd: master.workEnd,
    },
    services,
    statuses: Object.entries(APPOINTMENT_STATUS_LABELS)
      .filter(([code]) => code !== "CANCELLED")
      .map(([value, label]) => ({ value, label })),
    sources: Object.entries(APPOINTMENT_SOURCE_LABELS).map(
      ([value, label]) => ({ value, label }),
    ),
  };
}
