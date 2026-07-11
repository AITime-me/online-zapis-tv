import { NON_BLOCKING_APPOINTMENT_STATUSES } from "@/lib/schedule/non-blocking-appointment-statuses";
import { mapScheduleDayAppointmentOperational } from "@/lib/schedule/map-schedule-appointment";
import { prisma } from "@/lib/db";
import {
  formatDateKeyInStudio,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import { getBlockDisplayLabel } from "@/lib/schedule/labels";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import type { ScheduleDayExtraWork } from "@/types/schedule";

export class ExtraWorkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtraWorkValidationError";
  }
}

export type ExtraWorkWriteInput = {
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isOnlineBookingEnabled?: boolean;
};

function mapExtraWork(window: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  isOnlineBookingEnabled: boolean;
}): ScheduleDayExtraWork {
  return {
    id: window.id,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    isOnlineBookingEnabled: window.isOnlineBookingEnabled,
  };
}

export async function createExtraWorkWindow(
  input: ExtraWorkWriteInput,
  createdByUserId: string,
): Promise<ScheduleDayExtraWork> {
  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new ExtraWorkValidationError("Окончание должно быть позже начала");
  }

  const { noteDate } = getStudioDayRangeFromDateKey(input.dateKey);

  const window = await prisma.extraWorkWindow.create({
    data: {
      masterId: input.masterId,
      workDate: noteDate,
      startsAt,
      endsAt,
      isOnlineBookingEnabled: input.isOnlineBookingEnabled ?? false,
      createdByUserId,
    },
  });

  return mapExtraWork(window);
}

export async function deleteExtraWorkWindow(id: string): Promise<void> {
  await prisma.extraWorkWindow.delete({ where: { id } });
}

export async function getCellEditorData(
  masterId: string,
  dateKey: string,
) {
  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: {
      id: true,
      internalName: true,
      publicName: true,
    },
  });

  if (!master) {
    return null;
  }

  const [appointments, scheduleBlocks, extraWorkWindows] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        masterId,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      },
      include: { service: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.scheduleBlock.findMany({
      where: blocksForDayWhere(masterId, dateKey),
      orderBy: [{ isFullDay: "desc" }, { startsAt: "asc" }],
    }),
    prisma.extraWorkWindow.findMany({
      where: {
        masterId,
        workDate: noteDate,
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  return {
    dateKey,
    masterId: master.id,
    masterInternalName: master.internalName,
    masterPublicName: master.publicName,
    appointments: appointments.map(mapScheduleDayAppointmentOperational),
    scheduleBlocks: scheduleBlocks.map((block) => ({
      id: block.id,
      startsAt: block.isFullDay ? "" : (block.startsAt?.toISOString() ?? ""),
      endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
      blockType: block.blockType,
      blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
      internalReason: block.internalReason,
      isFullDay: block.isFullDay,
    })),
    extraWorkWindows: extraWorkWindows.map(mapExtraWork),
  };
}

export { formatDateKeyInStudio };
