import {
  AppointmentSource,
  AppointmentStatus,
  type Appointment,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  diffMinutes,
  formatDateKeyInStudio,
  formatStudioTimeInput,
  parseStudioDateTime,
} from "@/lib/datetime/date-key";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { checkMasterIntervalAvailability } from "@/services/MasterAvailabilityService";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import {
  calculateAppointmentEndsAt,
  resolveServiceTimingForMaster,
} from "@/services/ServiceTimingService";

export class AppointmentConflictError extends Error {
  constructor(message = "Это время уже занято") {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

export class AppointmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentValidationError";
  }
}

export type AppointmentWriteInput = {
  masterId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  serviceId?: string | null;
  clientName: string;
  clientPhone: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  comment?: string | null;
  importantNote?: string | null;
  isBold?: boolean;
  isManualTimeOverride?: boolean;
};

export type AppointmentDto = {
  id: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  comment: string | null;
  importantNote: string | null;
  isBold: boolean;
  isManualTimeOverride: boolean;
  status: string;
  source: string;
  statusCode: AppointmentStatus;
  sourceCode: AppointmentSource;
};

function mapAppointment(
  appointment: Appointment & { service: { publicName: string } | null },
): AppointmentDto {
  return {
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

async function loadConflictContext(
  masterId: string,
  dateKey: string,
  excludeAppointmentId?: string,
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
    throw new AppointmentValidationError("Мастер не найден");
  }

  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  const [appointments, scheduleBlocks, extraWorkWindows] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        masterId,
        startsAt: { gte: dayStart, lte: dayEnd },
        ...(excludeAppointmentId
          ? { id: { not: excludeAppointmentId } }
          : {}),
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    }),
    prisma.scheduleBlock.findMany({
      where: blocksForDayWhere(masterId, dateKey),
      select: {
        startsAt: true,
        endsAt: true,
        isFullDay: true,
      },
    }),
    prisma.extraWorkWindow.findMany({
      where: {
        masterId,
        workDate: noteDate,
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  return {
    master,
    appointments,
    scheduleBlocks,
    extraWorkWindows,
  };
}

async function assertNoBlockingConflict(
  input: AppointmentWriteInput,
  excludeAppointmentId?: string,
) {
  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new AppointmentValidationError("Окончание должно быть позже начала");
  }

  const context = await loadConflictContext(
    input.masterId,
    input.dateKey,
    excludeAppointmentId,
  );

  const workHours = resolveMasterWorkHours(context.master, input.dateKey);

  const availability = checkMasterIntervalAvailability({
    masterId: input.masterId,
    dateKey: input.dateKey,
    standardWorkStart: workHours.workStart,
    standardWorkEnd: workHours.workEnd,
    extraWorkWindows: context.extraWorkWindows,
    appointments: context.appointments,
    scheduleBlocks: context.scheduleBlocks.map((block) => ({
      startsAt: block.startsAt ?? new Date(0),
      endsAt: block.endsAt ?? new Date(0),
      isFullDay: block.isFullDay,
    })),
    candidateInterval: { startsAt, endsAt },
  });

  if (availability.conflicts.some((c) => c.type === "full_day_block")) {
    throw new AppointmentConflictError("День мастера закрыт");
  }

  if (availability.conflicts.some((c) => c.type === "block")) {
    throw new AppointmentConflictError("Это время закрыто блоком");
  }

  if (availability.conflicts.some((c) => c.type === "appointment")) {
    throw new AppointmentConflictError("Это время уже занято");
  }
}

async function resolveTimingFields(
  input: AppointmentWriteInput,
  startsAt: Date,
  endsAt: Date,
) {
  let standardDurationMinutes: number | null = null;
  let standardBreakAfterMinutes: number | null = null;
  let serviceDurationMinutes: number | null = null;
  let breakAfterMinutes: number | null = null;
  let isManualTimeOverride = input.isManualTimeOverride ?? false;

  const totalMinutes = diffMinutes(startsAt, endsAt);

  if (input.serviceId) {
    const timing = await resolveServiceTimingForMaster(
      input.masterId,
      input.serviceId,
    );

    if (timing) {
      standardDurationMinutes = timing.durationMinutes;
      standardBreakAfterMinutes = timing.breakAfterMinutes;
      const standardEndsAt = calculateAppointmentEndsAt(
        startsAt,
        timing.durationMinutes,
        timing.breakAfterMinutes,
      );

      if (
        endsAt.getTime() !== standardEndsAt.getTime() ||
        totalMinutes !== timing.totalBusyMinutes
      ) {
        isManualTimeOverride = true;
        serviceDurationMinutes = totalMinutes;
        breakAfterMinutes = 0;
      } else {
        serviceDurationMinutes = timing.durationMinutes;
        breakAfterMinutes = timing.breakAfterMinutes;
      }
    }
  }

  if (!input.serviceId || serviceDurationMinutes == null) {
    serviceDurationMinutes = totalMinutes;
    breakAfterMinutes = 0;
    isManualTimeOverride = true;
  }

  return {
    standardDurationMinutes,
    standardBreakAfterMinutes,
    serviceDurationMinutes,
    breakAfterMinutes,
    isManualTimeOverride,
  };
}

export async function createAppointment(
  input: AppointmentWriteInput,
  createdByUserId: string,
): Promise<AppointmentDto> {
  await assertNoBlockingConflict(input);

  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);
  const timingFields = await resolveTimingFields(input, startsAt, endsAt);

  const appointment = await prisma.appointment.create({
    data: {
      masterId: input.masterId,
      serviceId: input.serviceId ?? null,
      startsAt,
      endsAt,
      clientName: input.clientName.trim(),
      clientPhone: input.clientPhone.trim(),
      comment: input.comment?.trim() || null,
      importantNote: input.importantNote?.trim() || null,
      isBold: input.isBold ?? false,
      status: input.status,
      source: input.source,
      createdByUserId,
      ...timingFields,
    },
    include: { service: true },
  });

  return mapAppointment(appointment);
}

export async function updateAppointment(
  id: string,
  input: Partial<AppointmentWriteInput>,
): Promise<AppointmentDto> {
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true },
  });

  if (!existing) {
    throw new AppointmentValidationError("Запись не найдена");
  }

  const merged: AppointmentWriteInput = {
    masterId: input.masterId ?? existing.masterId,
    dateKey: input.dateKey ?? formatDateKeyInStudio(existing.startsAt),
    startTime: input.startTime ?? formatStudioTimeInput(existing.startsAt),
    endTime: input.endTime ?? formatStudioTimeInput(existing.endsAt),
    serviceId:
      input.serviceId !== undefined ? input.serviceId : existing.serviceId,
    clientName: input.clientName ?? existing.clientName,
    clientPhone: input.clientPhone ?? existing.clientPhone,
    status: input.status ?? existing.status,
    source: input.source ?? existing.source,
    comment: input.comment !== undefined ? input.comment : existing.comment,
    importantNote:
      input.importantNote !== undefined
        ? input.importantNote
        : existing.importantNote,
    isBold: input.isBold ?? existing.isBold,
    isManualTimeOverride:
      input.isManualTimeOverride ?? existing.isManualTimeOverride,
  };

  if (merged.status !== "CANCELLED") {
    await assertNoBlockingConflict(merged, id);
  }

  const startsAt = parseStudioDateTime(merged.dateKey, merged.startTime);
  const endsAt = parseStudioDateTime(merged.dateKey, merged.endTime);

  if (endsAt <= startsAt) {
    throw new AppointmentValidationError("Окончание должно быть позже начала");
  }

  const timingFields = await resolveTimingFields(merged, startsAt, endsAt);

  const data: Prisma.AppointmentUpdateInput = {
    service:
      merged.serviceId != null
        ? { connect: { id: merged.serviceId } }
        : { disconnect: true },
    startsAt,
    endsAt,
    clientName: merged.clientName.trim(),
    clientPhone: merged.clientPhone.trim(),
    comment: merged.comment?.trim() || null,
    importantNote: merged.importantNote?.trim() || null,
    isBold: merged.isBold ?? false,
    status: merged.status,
    source: merged.source,
    ...timingFields,
  };

  const appointment = await prisma.appointment.update({
    where: { id },
    data,
    include: { service: true },
  });

  return mapAppointment(appointment);
}

export async function cancelAppointment(id: string): Promise<AppointmentDto> {
  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
    include: { service: true },
  });

  return mapAppointment(appointment);
}

export { mapAppointment as mapAppointmentDto };
