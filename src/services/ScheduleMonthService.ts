import { ManagerNoteType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  formatDateKeyInStudio,
  getStudioNow,
  normalizeMonthKey,
} from "@/lib/datetime/date-layer";
import { getStudioMonthRangeFromMonthKey } from "@/lib/datetime/studio";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  getBlockDisplayLabel,
} from "@/lib/schedule/labels";
import { compareScheduleMonthCellItems } from "@/lib/schedule/datetime-guards";
import type {
  ScheduleMonthCellItem,
  ScheduleMonthData,
  ScheduleMonthDayCell,
} from "@/types/schedule-month";

function mapAppointment(
  appointment: Awaited<
    ReturnType<typeof prisma.appointment.findMany>
  >[number] & { service: { publicName: string } | null },
): ScheduleMonthCellItem {
  return {
    kind: "appointment",
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
  };
}

function mapBlock(
  block: Awaited<ReturnType<typeof prisma.scheduleBlock.findMany>>[number],
): ScheduleMonthCellItem {
  return {
    kind: "block",
    id: block.id,
    startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
    endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
    blockType: block.blockType,
    blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
    internalReason: block.internalReason,
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
): Promise<ScheduleMonthData> {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const { days, monthStart, monthEnd } =
    getStudioMonthRangeFromMonthKey(normalizedMonthKey);

  const [masters, managerNotes, appointments, scheduleBlocks, extraWorkWindows] =
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
      prisma.managerNote.findMany({
        where: {
          noteDate: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        orderBy: [{ noteDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.appointment.findMany({
        where: {
          startsAt: { gte: monthStart, lte: monthEnd },
          status: { not: "CANCELLED" },
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
    ]);

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
    items.push(mapAppointment(appointment));
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
    items.push(mapBlock(block));
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
