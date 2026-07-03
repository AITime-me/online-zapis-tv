import { prisma } from "@/lib/db";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";

export async function getScheduleEditorOptions(
  masterId: string,
  dateKey: string,
) {
  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: {
      id: true,
      workStart: true,
      workEnd: true,
      usesDefaultWorkHours: true,
    },
  });

  if (!master) {
    return null;
  }

  const workHours = resolveMasterWorkHours(master, dateKey);

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
      workStart: workHours.workStart,
      workEnd: workHours.workEnd,
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
