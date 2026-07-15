import {
  AppointmentSource,
  AppointmentStatus,
  type Appointment,
  type Prisma,
} from "@prisma/client";
import { isBlockingAppointmentStatus } from "@/lib/schedule/non-blocking-appointment-statuses";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";
import { logServiceError } from "@/lib/errors/format-service-error";
import { parseAppliedPromotions } from "@/lib/promo/applied-promotions";
import {
  addMinutesSafe,
  diffMinutes,
  formatDateKeyInStudio,
  formatStudioTimeInput,
  getEpochDate,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from "@/lib/schedule/labels";
import { checkMasterIntervalAvailability } from "@/services/MasterAvailabilityService";
import { resolveMasterWorkHours } from "@/lib/schedule/master-work-hours";
import { blocksForDayWhere } from "@/services/ScheduleBlockService";
import {
  normalizeMasterNote,
  validateMasterNote,
} from "@/lib/schedule/master-note-validation";
import {
  calculateAppointmentEndsAt,
  resolveServiceTimingForMaster,
} from "@/services/ServiceTimingService";
import { createManageToken } from "@/services/BookingManageService";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";

const APPOINTMENT_BUSY_CONFLICT_MESSAGE =
  "У мастера уже есть запись или перерыв в это время.";

export class AppointmentConflictError extends Error {
  constructor(message = APPOINTMENT_BUSY_CONFLICT_MESSAGE) {
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

function assertValidMasterNote(value: string | null | undefined): string | null {
  const validationError = validateMasterNote(value);
  if (validationError) {
    throw new AppointmentValidationError(validationError);
  }

  return normalizeMasterNote(value);
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
  appliedPromotions?: AppliedPromotionRecord[] | null;
  clientId?: string | null;
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
  manageToken?: string | null;
  appliedPromotions: AppliedPromotionRecord[];
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
    manageToken: appointment.manageToken,
    appliedPromotions: parseAppliedPromotions(appointment.appliedPromotions),
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
        breakAfterMinutes: true,
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

async function resolveBreakAfterMinutesForInput(
  input: AppointmentWriteInput,
): Promise<number> {
  if (!input.serviceId) {
    return 0;
  }

  const timing = await resolveServiceTimingForMaster(
    input.masterId,
    input.serviceId,
  );

  return timing?.breakAfterMinutes ?? 0;
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

  const [context, candidateBreakAfterMinutes] = await Promise.all([
    loadConflictContext(input.masterId, input.dateKey, excludeAppointmentId),
    resolveBreakAfterMinutesForInput(input),
  ]);

  const workHours = resolveMasterWorkHours(context.master, input.dateKey);

  const availability = checkMasterIntervalAvailability({
    masterId: input.masterId,
    dateKey: input.dateKey,
    standardWorkStart: workHours.workStart,
    standardWorkEnd: workHours.workEnd,
    extraWorkWindows: context.extraWorkWindows,
    appointments: context.appointments.map((appointment) => ({
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      breakAfterMinutes: appointment.breakAfterMinutes ?? 0,
      status: appointment.status,
    })),
    scheduleBlocks: context.scheduleBlocks.map((block) => ({
      startsAt: block.startsAt ?? getEpochDate(),
      endsAt: block.endsAt ?? getEpochDate(),
      isFullDay: block.isFullDay,
    })),
    candidateInterval: {
      startsAt,
      endsAt,
      breakAfterMinutes: candidateBreakAfterMinutes,
    },
  });

  if (availability.conflicts.some((c) => c.type === "full_day_block")) {
    throw new AppointmentConflictError("День мастера закрыт");
  }

  if (availability.conflicts.some((c) => c.type === "block")) {
    throw new AppointmentConflictError("Это время закрыто блоком");
  }

  if (availability.conflicts.some((c) => c.type === "appointment")) {
    throw new AppointmentConflictError(APPOINTMENT_BUSY_CONFLICT_MESSAGE);
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
      const durationOnlyEndsAt =
        addMinutesSafe(startsAt, timing.durationMinutes) ?? startsAt;
      const withBreakEndsAt = calculateAppointmentEndsAt(
        startsAt,
        timing.durationMinutes,
        timing.breakAfterMinutes,
      );

      if (endsAt.getTime() === durationOnlyEndsAt.getTime()) {
        serviceDurationMinutes = timing.durationMinutes;
        breakAfterMinutes = timing.breakAfterMinutes;
        isManualTimeOverride = false;
      } else if (endsAt.getTime() === withBreakEndsAt.getTime()) {
        serviceDurationMinutes = timing.durationMinutes;
        breakAfterMinutes = timing.breakAfterMinutes;
        isManualTimeOverride = false;
      } else {
        isManualTimeOverride = true;
        serviceDurationMinutes = totalMinutes;
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
  return createAppointmentRecord(input, createdByUserId);
}

export async function createOnlineAppointment(
  input: Omit<AppointmentWriteInput, "status" | "source"> & {
    serviceId: string;
  },
): Promise<AppointmentDto> {
  return createAppointmentRecord(
    {
      ...input,
      status: "SCHEDULED",
      source: "ONLINE",
    },
    null,
  );
}

async function createAppointmentRecord(
  input: AppointmentWriteInput,
  createdByUserId: string | null,
): Promise<AppointmentDto> {
  try {
    if (!input.masterId?.trim()) {
      throw new AppointmentValidationError("Не указан мастер");
    }
    if (!input.serviceId?.trim()) {
      throw new AppointmentValidationError("Не указана услуга");
    }
    if (!input.status) {
      throw new AppointmentValidationError("Не указан статус записи");
    }
    if (!input.clientName?.trim()) {
      throw new AppointmentValidationError("Не указано имя клиента");
    }
    if (!input.clientPhone?.trim()) {
      throw new AppointmentValidationError("Не указан телефон клиента");
    }

    await assertNoBlockingConflict(input);

    const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
    const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      throw new AppointmentValidationError("Некорректные дата или время записи");
    }

    const timingFields = await resolveTimingFields(input, startsAt, endsAt);
    const manageToken =
      input.source === "ONLINE" ? createManageToken() : null;

    if (input.source === "ONLINE" && !manageToken) {
      throw new AppointmentValidationError("Не удалось сгенерировать manageToken");
    }

    const createPayload: Prisma.AppointmentCreateInput = {
      master: { connect: { id: input.masterId } },
      service: { connect: { id: input.serviceId! } },
      startsAt,
      endsAt,
      clientName: input.clientName.trim(),
      clientPhone: input.clientPhone.trim(),
      comment: input.comment?.trim() || null,
      importantNote: assertValidMasterNote(input.importantNote),
      isBold: input.isBold ?? false,
      status: input.status,
      source: input.source,
      manageToken,
      ...(createdByUserId
        ? { createdByUser: { connect: { id: createdByUserId } } }
        : {}),
      ...(input.appliedPromotions && input.appliedPromotions.length > 0
        ? {
            appliedPromotions: input.appliedPromotions as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.clientId
        ? { client: { connect: { id: input.clientId } } }
        : {}),
      ...timingFields,
    };

    if (process.env.NODE_ENV !== "production") {
      safeLogError("[appointment.create] payload", null, {
        masterId: input.masterId,
        serviceId: input.serviceId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: input.status,
        source: input.source,
        appliedPromotionsCount: input.appliedPromotions?.length ?? 0,
        serviceDurationMinutes: timingFields.serviceDurationMinutes,
        breakAfterMinutes: timingFields.breakAfterMinutes,
      });
    }

    const appointment = await prisma.appointment.create({
      data: createPayload,
      include: { service: true },
    });

    if (input.source === "ONLINE" && !appointment.manageToken) {
      throw new AppointmentValidationError(
        "Запись создана без manageToken — проверьте миграцию appointments.manage_token",
      );
    }

    return mapAppointment(appointment);
  } catch (error) {
    logServiceError("appointment.create", error);
    throw error;
  }
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

  // Защита от гонки: отложенный PATCH после мягкой отмены не должен
  // восстанавливать CANCELLED запись в активный статус.
  if (existing.status === "CANCELLED") {
    throw new AppointmentValidationError(
      "Запись уже отменена и не может быть изменена",
    );
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
        ? assertValidMasterNote(input.importantNote)
        : existing.importantNote,
    isBold: input.isBold ?? existing.isBold,
    isManualTimeOverride:
      input.isManualTimeOverride ?? existing.isManualTimeOverride,
  };

  if (isBlockingAppointmentStatus(merged.status)) {
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
    importantNote: assertValidMasterNote(merged.importantNote),
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
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true },
  });

  if (!existing) {
    throw new AppointmentValidationError("Запись не найдена");
  }

  if (existing.status === "CANCELLED") {
    return mapAppointment(existing);
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: getStudioNow(),
    },
    include: { service: true },
  });

  return mapAppointment(appointment);
}

export { mapAppointment as mapAppointmentDto };
