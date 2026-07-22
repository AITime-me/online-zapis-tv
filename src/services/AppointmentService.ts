import {
  AppointmentSource,
  AppointmentStatus,
  Prisma,
  type Appointment,
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
import { createManageToken, createPublicRequestReference, hashManageToken } from "@/lib/booking/manage-token";
import { recordRequiredPublicFormAcceptances } from "@/services/LegalAcceptanceService";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";
import {
  APPOINTMENT_BUSY_CONFLICT_MESSAGE,
  resolveAppointmentWriteConflict,
  type AppointmentConflictCode,
  type AppointmentConflictType,
} from "@/lib/schedule/appointment-write-conflicts";

export {
  resolveAppointmentWriteConflict,
  type AppointmentConflictCode,
  type AppointmentConflictType,
  type AppointmentWriteConflict,
} from "@/lib/schedule/appointment-write-conflicts";

/** Максимум повторов Serializable-транзакции при P2034. */
export const APPOINTMENT_WRITE_SERIALIZABLE_RETRIES = 3;

/** Минимальный Prisma client для проверки конфликтов внутри транзакции. */
export type AppointmentConflictDbClient = Pick<
  Prisma.TransactionClient,
  "master" | "appointment" | "scheduleBlock" | "extraWorkWindow"
>;

export class AppointmentConflictError extends Error {
  readonly code?: AppointmentConflictCode;
  readonly conflictType?: AppointmentConflictType;

  constructor(
    message = APPOINTMENT_BUSY_CONFLICT_MESSAGE,
    meta?: { code: AppointmentConflictCode; conflictType: AppointmentConflictType },
  ) {
    super(message);
    this.name = "AppointmentConflictError";
    if (meta) {
      this.code = meta.code;
      this.conflictType = meta.conflictType;
    }
  }
}

export class AppointmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentValidationError";
  }
}

function isAppointmentSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
  );
}

export async function runSerializableAppointmentWrite<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < APPOINTMENT_WRITE_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        isAppointmentSerializationFailure(error) &&
        attempt < APPOINTMENT_WRITE_SERIALIZABLE_RETRIES - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("appointment serializable transaction failed");
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
  /** Только для публичной ONLINE-записи: писать LegalAcceptanceRecord в той же транзакции. */
  recordPublicLegalAcceptances?: boolean;
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
  appliedPromotions: AppliedPromotionRecord[];
};

/** Результат ONLINE create: DTO без секрета + одноразовая выдача raw token клиенту. */
export type OnlineAppointmentCreateResult = {
  appointment: AppointmentDto;
  issuedManageToken: string;
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
    appliedPromotions: parseAppliedPromotions(appointment.appliedPromotions),
  };
}

async function loadConflictContext(
  db: AppointmentConflictDbClient,
  masterId: string,
  dateKey: string,
  excludeAppointmentId?: string,
) {
  const master = await db.master.findUnique({
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
    db.appointment.findMany({
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
    db.scheduleBlock.findMany({
      where: blocksForDayWhere(masterId, dateKey),
      select: {
        startsAt: true,
        endsAt: true,
        isFullDay: true,
      },
    }),
    db.extraWorkWindow.findMany({
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
  db: AppointmentConflictDbClient,
  input: AppointmentWriteInput,
  candidateBreakAfterMinutes: number,
  excludeAppointmentId?: string,
  writeOptions?: { allowAppointmentOverlap?: boolean },
) {
  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (endsAt <= startsAt) {
    throw new AppointmentValidationError("Окончание должно быть позже начала");
  }

  const context = await loadConflictContext(
    db,
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
    constrainAppointmentEnd: workHours.constrainAppointmentEnd,
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

  const blockingConflict = resolveAppointmentWriteConflict(
    availability.conflicts,
    writeOptions?.allowAppointmentOverlap === true,
  );

  if (blockingConflict) {
    throw new AppointmentConflictError(blockingConflict.message, {
      code: blockingConflict.code,
      conflictType: blockingConflict.conflictType,
    });
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

export type CreateAppointmentOptions = {
  /** Только ручной create: строго true разрешает overlap с другой записью мастера. */
  allowAppointmentOverlap?: boolean;
};

export async function createAppointment(
  input: AppointmentWriteInput,
  createdByUserId: string,
  options?: CreateAppointmentOptions,
): Promise<AppointmentDto> {
  const result = await createAppointmentRecord(input, createdByUserId, {
    allowAppointmentOverlap: options?.allowAppointmentOverlap === true,
  });
  return result.appointment;
}

export async function createOnlineAppointment(
  input: Omit<AppointmentWriteInput, "status" | "source"> & {
    serviceId: string;
  },
): Promise<OnlineAppointmentCreateResult> {
  // Public path never receives overlap override options — overlap stays blocked.
  const result = await createAppointmentRecord(
    {
      ...input,
      status: "SCHEDULED",
      source: "ONLINE",
      recordPublicLegalAcceptances: true,
    },
    null,
  );

  if (!result.issuedManageToken) {
    throw new AppointmentValidationError(
      "Запись создана без manage token — проверьте миграцию appointments.manage_token_hash",
    );
  }

  return {
    appointment: result.appointment,
    issuedManageToken: result.issuedManageToken,
  };
}

type AppointmentCreateRecordResult = {
  appointment: AppointmentDto;
  issuedManageToken: string | null;
};

async function createAppointmentRecord(
  input: AppointmentWriteInput,
  createdByUserId: string | null,
  options?: CreateAppointmentOptions,
): Promise<AppointmentCreateRecordResult> {
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

    const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
    const endsAt = parseStudioDateTime(input.dateKey, input.endTime);

    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      throw new AppointmentValidationError("Некорректные дата или время записи");
    }

    if (endsAt <= startsAt) {
      throw new AppointmentValidationError("Окончание должно быть позже начала");
    }

    const [timingFields, candidateBreakAfterMinutes] = await Promise.all([
      resolveTimingFields(input, startsAt, endsAt),
      resolveBreakAfterMinutesForInput(input),
    ]);

    const issuedManageToken =
      input.source === "ONLINE" ? createManageToken() : null;
    const manageTokenHash = issuedManageToken
      ? hashManageToken(issuedManageToken)
      : null;

    if (input.source === "ONLINE" && (!issuedManageToken || !manageTokenHash)) {
      throw new AppointmentValidationError("Не удалось сгенерировать manage token");
    }

    const publicRequestReference =
      input.recordPublicLegalAcceptances && input.source === "ONLINE"
        ? createPublicRequestReference()
        : null;

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
      // Phase A EXPAND dual-write: plaintext kept so rollback image (pre-hash) can still resolve manage-link.
      manageToken: issuedManageToken,
      manageTokenHash,
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
        hasManageTokenHash: Boolean(manageTokenHash),
        // Never log issuedManageToken / raw manageToken
      });
    }

    const appointment = await runSerializableAppointmentWrite(async (tx) => {
      await assertNoBlockingConflict(
        tx,
        input,
        candidateBreakAfterMinutes,
        undefined,
        {
          allowAppointmentOverlap: options?.allowAppointmentOverlap === true,
        },
      );

      const created = await tx.appointment.create({
        data: createPayload,
        include: { service: true },
      });

      if (input.recordPublicLegalAcceptances && input.source === "ONLINE") {
        await recordRequiredPublicFormAcceptances(tx, {
          source: "ONLINE_BOOKING",
          appointmentId: created.id,
          clientId: input.clientId ?? null,
          requestReference: publicRequestReference,
        });
      }

      return created;
    });

    if (
      input.source === "ONLINE" &&
      (!appointment.manageTokenHash || !appointment.manageToken)
    ) {
      throw new AppointmentValidationError(
        "Запись создана без Phase A dual-write manage token — проверьте миграцию appointments.manage_token_hash",
      );
    }

    return {
      appointment: mapAppointment(appointment),
      issuedManageToken,
    };
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

  const needsConflictCheck = isBlockingAppointmentStatus(merged.status);
  const candidateBreakAfterMinutes = needsConflictCheck
    ? await resolveBreakAfterMinutesForInput(merged)
    : 0;

  const appointment = needsConflictCheck
    ? await runSerializableAppointmentWrite(async (tx) => {
        await assertNoBlockingConflict(
          tx,
          merged,
          candidateBreakAfterMinutes,
          id,
        );

        return tx.appointment.update({
          where: { id },
          data,
          include: { service: true },
        });
      })
    : await prisma.appointment.update({
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
