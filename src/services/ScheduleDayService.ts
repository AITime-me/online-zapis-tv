import { prisma } from "@/lib/db";
import { ManagerNoteType } from "@prisma/client";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import { getBlockDisplayLabel } from "@/lib/schedule/labels";
import { mapScheduleDayAppointment } from "@/lib/schedule/map-schedule-appointment";
import type { ScheduleDayData } from "@/types/schedule";
import { listActiveBookingRequestsForRange } from "@/services/BookingRequestService";
import {
  resolveAppointmentVisibility,
  resolveBookingRequestVisibility,
  SCHEDULE_LOAD_INTERNAL,
  type ScheduleLoadOptions,
} from "@/lib/schedule/schedule-load-options";

export async function getScheduleDayData(
  dateKey: string,
  options: ScheduleLoadOptions = SCHEDULE_LOAD_INTERNAL,
): Promise<ScheduleDayData> {
  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);
  const includeManagerColumn = options.includeManagerColumn ?? true;
  const bookingRequestVisibility = resolveBookingRequestVisibility(options);
  const appointmentVisibility = resolveAppointmentVisibility(options);
  const stripBlockInternalReason = options.stripBlockInternalReason ?? false;
  const includeBookingRequests =
    includeManagerColumn && bookingRequestVisibility !== "none";

  const [masters, managerNotes, extraWorkWindows, bookingRequests] = await Promise.all([
    prisma.master.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        appointments: {
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
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
    includeManagerColumn
      ? prisma.managerNote.findMany({
          where: { noteDate, noteType: ManagerNoteType.MANAGER },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.extraWorkWindow.findMany({
      where: { workDate: noteDate },
      orderBy: { startsAt: "asc" },
    }),
    includeBookingRequests
      ? listActiveBookingRequestsForRange(
          dayStart,
          dayEnd,
          bookingRequestVisibility,
        )
      : Promise.resolve([]),
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
    bookingRequests,
    masters: masters.map((master) => ({
      id: master.id,
      internalName: master.internalName,
      publicName: master.publicName,
      appointments: master.appointments.map((appointment) =>
        mapScheduleDayAppointment(appointment, appointmentVisibility),
      ),
      scheduleBlocks: master.scheduleBlocks.map((block) => ({
        id: block.id,
        startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
        endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
        blockType: block.blockType,
        blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
        internalReason: stripBlockInternalReason ? null : block.internalReason,
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
