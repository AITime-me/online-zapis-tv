import { ManagerNoteType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  formatDateKeyInStudio,
  getStudioNow,
  normalizeDate,
  normalizeMonthKey,
} from "@/lib/datetime/date-layer";
import { getStudioMonthRangeFromMonthKey } from "@/lib/datetime/studio";
import {
  getBlockDisplayLabel,
} from "@/lib/schedule/labels";
import { compareScheduleMonthCellItems } from "@/lib/schedule/datetime-guards";
import { mapScheduleDayAppointment } from "@/lib/schedule/map-schedule-appointment";
import type {
  ScheduleMonthCellItem,
  ScheduleMonthData,
  ScheduleMonthDayCell,
} from "@/types/schedule-month";
import { listActiveBookingRequestsForRange } from "@/services/BookingRequestService";
import {
  resolveAppointmentVisibility,
  resolveBookingRequestVisibility,
  resolveIncludeOperationalNotes,
  SCHEDULE_LOAD_INTERNAL,
  type ScheduleLoadOptions,
} from "@/lib/schedule/schedule-load-options";

function mapAppointment(
  appointment: Awaited<
    ReturnType<typeof prisma.appointment.findMany>
  >[number] & { service: { publicName: string } | null },
  appointmentVisibility: ReturnType<typeof resolveAppointmentVisibility>,
): ScheduleMonthCellItem {
  return {
    kind: "appointment",
    ...mapScheduleDayAppointment(appointment, appointmentVisibility),
  };
}

function mapBlock(
  block: Awaited<ReturnType<typeof prisma.scheduleBlock.findMany>>[number],
  stripInternalReason: boolean,
): ScheduleMonthCellItem {
  return {
    kind: "block",
    id: block.id,
    startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
    endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
    blockType: block.blockType,
    blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
    internalReason: stripInternalReason ? null : block.internalReason,
    isFullDay: block.isFullDay,
  };
}

function mapExtraWork(
  window: Awaited<ReturnType<typeof prisma.extraWorkWindow.findMany>>[number],
): ScheduleMonthCellItem {
  return {
    kind: "extraWork",
    id: window.id,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    isOnlineBookingEnabled: window.isOnlineBookingEnabled,
  };
}

function sortCellItems(items: ScheduleMonthCellItem[]): ScheduleMonthCellItem[] {
  return [...items].sort(compareScheduleMonthCellItems);
}

export async function getScheduleMonthData(
  monthKey: string,
  options: ScheduleLoadOptions = SCHEDULE_LOAD_INTERNAL,
): Promise<ScheduleMonthData> {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const { days, monthStart, monthEnd } =
    getStudioMonthRangeFromMonthKey(normalizedMonthKey);
  const includeManagerColumn = options.includeManagerColumn ?? true;
  const includeOperationalNotes = resolveIncludeOperationalNotes(options);
  const bookingRequestVisibility = resolveBookingRequestVisibility(options);
  const appointmentVisibility = resolveAppointmentVisibility(options);
  const stripBlockInternalReason = options.stripBlockInternalReason ?? false;
  const includeBookingRequests =
    includeManagerColumn && bookingRequestVisibility !== "none";

  const [masters, managerNotes, appointments, scheduleBlocks, extraWorkWindows, bookingRequests] =
    await Promise.all([
      prisma.master.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          internalName: true,
          publicName: true,
        },
      }),
      includeOperationalNotes
        ? prisma.managerNote.findMany({
            where: {
              noteDate: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
            orderBy: [{ noteDate: "asc" }, { createdAt: "asc" }],
          })
        : Promise.resolve([]),
      prisma.appointment.findMany({
        where: {
          startsAt: { gte: monthStart, lte: monthEnd },
        },
        include: { service: true },
        orderBy: { startsAt: "asc" },
      }),
      prisma.scheduleBlock.findMany({
        where: {
          masterId: { not: null },
          OR: [
            {
              isFullDay: false,
              startsAt: { gte: monthStart, lte: monthEnd },
            },
            {
              isFullDay: true,
              blockDate: { gte: monthStart, lte: monthEnd },
            },
          ],
        },
        orderBy: [{ isFullDay: "desc" }, { startsAt: "asc" }],
      }),
      prisma.extraWorkWindow.findMany({
        where: {
          workDate: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        orderBy: { startsAt: "asc" },
      }),
      includeBookingRequests
        ? listActiveBookingRequestsForRange(
            monthStart,
            monthEnd,
            bookingRequestVisibility,
          )
        : Promise.resolve([]),
    ]);

  const bookingRequestsByDate = new Map<string, ScheduleMonthDayCell["bookingRequests"]>();
  for (const request of bookingRequests) {
    const createdAt = normalizeDate(request.createdAt);
    if (!createdAt) {
      continue;
    }
    const dateKey = formatDateKeyInStudio(createdAt);
    const bucket = bookingRequestsByDate.get(dateKey) ?? [];
    bucket.push(request);
    bookingRequestsByDate.set(dateKey, bucket);
  }

  const managerNotesByDate = new Map<string, ScheduleMonthDayCell["managerNotes"]>();
  const ownerNotesByDate = new Map<string, ScheduleMonthDayCell["ownerNotes"]>();
  for (const note of managerNotes) {
    const dateKey = formatDateKeyInStudio(note.noteDate);
    const mapped = {
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
    };

    if (note.noteType === ManagerNoteType.OWNER) {
      const bucket = ownerNotesByDate.get(dateKey) ?? [];
      bucket.push(mapped);
      ownerNotesByDate.set(dateKey, bucket);
      continue;
    }

    if (!includeManagerColumn) {
      continue;
    }

    const bucket = managerNotesByDate.get(dateKey) ?? [];
    bucket.push(mapped);
    managerNotesByDate.set(dateKey, bucket);
  }

  const appointmentsByDateMaster = new Map<string, Map<string, ScheduleMonthCellItem[]>>();
  for (const appointment of appointments) {
    const dateKey = formatDateKeyInStudio(appointment.startsAt);
    const masterMap =
      appointmentsByDateMaster.get(dateKey) ?? new Map<string, ScheduleMonthCellItem[]>();
    const items = masterMap.get(appointment.masterId) ?? [];
    items.push(mapAppointment(appointment, appointmentVisibility));
    masterMap.set(appointment.masterId, items);
    appointmentsByDateMaster.set(dateKey, masterMap);
  }

  const blocksByDateMaster = new Map<string, Map<string, ScheduleMonthCellItem[]>>();
  for (const block of scheduleBlocks) {
    if (!block.masterId) {
      continue;
    }
    const dateKey = block.isFullDay
      ? formatDateKeyInStudio(block.blockDate!)
      : formatDateKeyInStudio(block.startsAt!);
    const masterMap =
      blocksByDateMaster.get(dateKey) ?? new Map<string, ScheduleMonthCellItem[]>();
    const items = masterMap.get(block.masterId) ?? [];
    items.push(mapBlock(block, stripBlockInternalReason));
    masterMap.set(block.masterId, items);
    blocksByDateMaster.set(dateKey, masterMap);
  }

  const extraWorkByDateMaster = new Map<string, Map<string, ScheduleMonthCellItem[]>>();
  for (const window of extraWorkWindows) {
    const dateKey = formatDateKeyInStudio(window.workDate);
    const masterMap =
      extraWorkByDateMaster.get(dateKey) ?? new Map<string, ScheduleMonthCellItem[]>();
    const items = masterMap.get(window.masterId) ?? [];
    items.push(mapExtraWork(window));
    masterMap.set(window.masterId, items);
    extraWorkByDateMaster.set(dateKey, masterMap);
  }

  const monthDays: ScheduleMonthDayCell[] = days.map((dateKey) => {
    const masterCells: Record<string, ScheduleMonthCellItem[]> = {};

    for (const master of masters) {
      const items: ScheduleMonthCellItem[] = [
        ...(appointmentsByDateMaster.get(dateKey)?.get(master.id) ?? []),
        ...(blocksByDateMaster.get(dateKey)?.get(master.id) ?? []),
        ...(extraWorkByDateMaster.get(dateKey)?.get(master.id) ?? []),
      ];
      masterCells[master.id] = sortCellItems(items);
    }

    return {
      dateKey,
      managerNotes: managerNotesByDate.get(dateKey) ?? [],
      bookingRequests: bookingRequestsByDate.get(dateKey) ?? [],
      ownerNotes: ownerNotesByDate.get(dateKey) ?? [],
      masterCells,
    };
  });

  return {
    month: normalizedMonthKey,
    studioToday: formatDateKeyInStudio(getStudioNow()),
    masters,
    days: monthDays,
  };
}
