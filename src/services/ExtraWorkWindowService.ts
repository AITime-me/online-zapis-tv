import type { Prisma, ScheduleResourceOrigin } from "@prisma/client";
import {
  APPOINTMENT_BUSY_TIMING_SELECT,
  getAppointmentBusyInterval,
} from "@/lib/schedule/appointment-busy";
import {
  activeScheduleAppointmentWhere,
  NON_BLOCKING_APPOINTMENT_STATUSES,
} from "@/lib/schedule/non-blocking-appointment-statuses";
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
  readonly code: ExtraWorkValidationCode;

  constructor(code: ExtraWorkValidationCode, message: string) {
    super(message);
    this.name = "ExtraWorkValidationError";
    this.code = code;
  }
}

export type ExtraWorkValidationCode = "NOT_FOUND" | "INVALID_RANGE";

export class ExtraWorkOwnershipError extends Error {
  readonly code: ExtraWorkOwnershipCode;

  constructor(code: ExtraWorkOwnershipCode, message: string) {
    super(message);
    this.name = "ExtraWorkOwnershipError";
    this.code = code;
  }
}

export type ExtraWorkOwnershipCode = "CROSS_MASTER" | "WRONG_ORIGIN";

export class ExtraWorkInUseError extends Error {
  readonly code = "IN_USE" as const;

  constructor(message: string) {
    super(message);
    this.name = "ExtraWorkInUseError";
  }
}

export type ExtraWorkWriteInput = {
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isOnlineBookingEnabled?: boolean;
};

export type ExtraWorkDbClient = Pick<
  Prisma.TransactionClient,
  "appointment" | "extraWorkWindow"
>;

export type ExtraWorkCreateMeta = {
  createdByUserId: string | null;
  origin?: ScheduleResourceOrigin;
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

export async function createExtraWorkWindowWithDb(
  db: ExtraWorkDbClient,
  input: ExtraWorkWriteInput,
  meta: ExtraWorkCreateMeta,
): Promise<ScheduleDayExtraWork> {
  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new ExtraWorkValidationError(
      "INVALID_RANGE",
      "Окончание должно быть позже начала",
    );
  }

  const { noteDate } = getStudioDayRangeFromDateKey(input.dateKey);

  const window = await db.extraWorkWindow.create({
    data: {
      masterId: input.masterId,
      workDate: noteDate,
      startsAt,
      endsAt,
      isOnlineBookingEnabled: input.isOnlineBookingEnabled ?? false,
      origin: meta.origin ?? "ADMIN_UI",
      createdByUserId: meta.createdByUserId,
    },
  });

  return mapExtraWork(window);
}

export async function createExtraWorkWindow(
  input: ExtraWorkWriteInput,
  createdByUserId: string,
): Promise<ScheduleDayExtraWork> {
  return createExtraWorkWindowWithDb(prisma, input, {
    createdByUserId,
    origin: "ADMIN_UI",
  });
}

export async function deleteExtraWorkWindow(id: string): Promise<void> {
  await prisma.extraWorkWindow.delete({ where: { id } });
}

/**
 * Cancel only a caller-owned master-command extra work window.
 * Refuses when active appointments overlap the window interval.
 */
export async function deleteOwnedMasterExtraWorkWindow(
  db: ExtraWorkDbClient,
  input: {
    extraWorkWindowId: string;
    masterId: string;
    requiredOrigin?: ScheduleResourceOrigin;
  },
): Promise<{ extraWorkWindowId: string }> {
  const requiredOrigin = input.requiredOrigin ?? "BOT_MASTER_COMMAND";
  const existing = await db.extraWorkWindow.findUnique({
    where: { id: input.extraWorkWindowId },
    select: {
      id: true,
      masterId: true,
      origin: true,
      startsAt: true,
      endsAt: true,
      workDate: true,
    },
  });

  if (!existing) {
    throw new ExtraWorkValidationError("NOT_FOUND", "Окно не найдено");
  }

  if (existing.masterId !== input.masterId) {
    throw new ExtraWorkOwnershipError(
      "CROSS_MASTER",
      "Окно принадлежит другому мастеру",
    );
  }

  if (existing.origin !== requiredOrigin) {
    throw new ExtraWorkOwnershipError(
      "WRONG_ORIGIN",
      "Окно нельзя удалить через master command",
    );
  }

  const dateKey = formatDateKeyInStudio(existing.workDate);
  const { dayStart, dayEnd } = getStudioDayRangeFromDateKey(dateKey);

  const appointments = await db.appointment.findMany({
    where: {
      masterId: input.masterId,
      status: { notIn: [...NON_BLOCKING_APPOINTMENT_STATUSES] },
      startsAt: { gte: dayStart, lte: dayEnd },
    },
    select: APPOINTMENT_BUSY_TIMING_SELECT,
  });

  const hasOverlap = appointments.some((appointment) => {
    const busy = getAppointmentBusyInterval(appointment);
    return (
      busy.startsAt < existing.endsAt && busy.endsAt > existing.startsAt
    );
  });

  if (hasOverlap) {
    throw new ExtraWorkInUseError(
      "В дополнительном окне есть активные записи",
    );
  }

  await db.extraWorkWindow.delete({ where: { id: existing.id } });
  return { extraWorkWindowId: existing.id };
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
        ...activeScheduleAppointmentWhere(),
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
