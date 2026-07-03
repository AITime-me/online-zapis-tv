import { prisma } from "@/lib/db";
import { ManagerNoteType } from "@prisma/client";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  getBlockDisplayLabel,
} from "@/lib/schedule/labels";
import type { ScheduleDayData } from "@/types/schedule";

export async function getScheduleDayData(
  dateKey: string,
): Promise<ScheduleDayData> {
  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  const [masters, managerNotes, extraWorkWindows] = await Promise.all([
    prisma.master.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        appointments: {
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
            status: { not: "CANCELLED" },
          },
          include: { service: true },
          orderBy: { startsAt: "asc" },
        },
        scheduleBlocks: {
          where: {
            OR: [
              {
                isFullDay: false,
                startsAt: { gte: dayStart, lte: dayEnd },
              },
              {
                isFullDay: true,
                blockDate: noteDate,
              },
            ],
          },
          orderBy: [{ isFullDay: "desc" }, { startsAt: "asc" }],
        },
      },
    }),
    prisma.managerNote.findMany({
      where: { noteDate, noteType: ManagerNoteType.MANAGER },
      orderBy: { createdAt: "asc" },
    }),
    prisma.extraWorkWindow.findMany({
      where: { workDate: noteDate },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const extraWorkByMaster = new Map<string, typeof extraWorkWindows>();
  for (const window of extraWorkWindows) {
    const bucket = extraWorkByMaster.get(window.masterId) ?? [];
    bucket.push(window);
    extraWorkByMaster.set(window.masterId, bucket);
  }

  return {
    date: dateKey,
    managerNotes: managerNotes.map((note) => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
    })),
    masters: masters.map((master) => ({
      id: master.id,
      internalName: master.internalName,
      publicName: master.publicName,
      appointments: master.appointments.map((appointment) => ({
        id: appointment.id,
        serviceId: appointment.serviceId,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        serviceName: appointment.service?.publicName ?? null,
        comment: appointment.comment,
        importantNote: appointment.importantNote,
        isBold: appointment.isBold,
        isManualTimeOverride: appointment.isManualTimeOverride,
        status: APPOINTMENT_STATUS_LABELS[appointment.status],
        source: APPOINTMENT_SOURCE_LABELS[appointment.source],
        statusCode: appointment.status,
        sourceCode: appointment.source,
      })),
      scheduleBlocks: master.scheduleBlocks.map((block) => ({
        id: block.id,
        startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
        endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
        blockType: block.blockType,
        blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
        internalReason: block.internalReason,
        isFullDay: block.isFullDay,
      })),
      extraWorkWindows: (extraWorkByMaster.get(master.id) ?? []).map((window) => ({
        id: window.id,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        isOnlineBookingEnabled: window.isOnlineBookingEnabled,
      })),
    })),
  };
}
