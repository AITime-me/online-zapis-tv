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
import { resolveServiceTimingForMaster } from "@/services/ServiceTimingService";
import { createManageToken, createPublicRequestReference, hashManageToken } from "@/lib/booking/manage-token";
import { recordRequiredPublicFormAcceptances } from "@/services/LegalAcceptanceService";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";
import {
  APPOINTMENT_BUSY_CONFLICT_MESSAGE,
  resolveAppointmentWriteConflict,
  type AppointmentConflictCode,
  type AppointmentConflictType,
} from "@/lib/schedule/appointment-write-conflicts";
import {
  APPOINTMENT_BUSY_TIMING_SELECT,
  getAppointmentBusyInterval,
  type AppointmentBusyTimingSnapshot,
} from "@/lib/schedule/appointment-busy";
import {
  AppointmentTimingValidationError,
  buildAppointmentTimingWriteData,
  isAppointmentTimingDirty,
} from "@/lib/schedule/appointment-timing-write";
import {
  assertLinkableClientForAppointment,
  syncCompletedAppointmentClientLink,
} from "@/services/AppointmentClientLinkService";
import type { AppointmentClientLinkResult } from "@/types/appointment-client-link";

export {
  resolveAppointmentWriteConflict,
  type AppointmentConflictCode,
  type AppointmentConflictType,
  type AppointmentWriteConflict,
} from "@/lib/schedule/appointment-write-conflicts";

export type { AppointmentClientLinkResult };

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

function rethrowTimingValidation(error: unknown): never {
  if (error instanceof AppointmentTimingValidationError) {
    throw new AppointmentValidationError(error.message);
  }
  throw error;
}

function toBusyTimingSnapshot(
  appointment: AppointmentBusyTimingSnapshot,
): AppointmentBusyTimingSnapshot {
  return {
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    timingSemanticsVersion: appointment.timingSemanticsVersion ?? 1,
    breakAfterMinutes: appointment.breakAfterMinutes,
    standardBreakAfterMinutes: appointment.standardBreakAfterMinutes,
    standardDurationMinutes: appointment.standardDurationMinutes,
    isManualTimeOverride: appointment.isManualTimeOverride,
  };
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

/** OWNER/MANAGER write/read DTO — включает CRM clientId. */
export type OperationalAppointmentDto = AppointmentDto & {
  clientId: string | null;
};

export type AppointmentMutationResult = {
  appointment: OperationalAppointmentDto;
  clientLink: AppointmentClientLinkResult;
};

/** Результат ONLINE create: DTO без секрета + одноразовая выдача raw token клиенту. */
export type OnlineAppointmentCreateResult = {
  appointment: AppointmentDto;
  issuedManageToken: string;
};

function mapAppointment(
  appointment: Appointment & { service: { publicName: string } | null },
): AppointmentDto {
  const busyEnd = getAppointmentBusyInterval(
    toBusyTimingSnapshot(appointment),
  ).endsAt;

  return {
    id: appointment.id,
    serviceId: appointment.serviceId,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: busyEnd.toISOString(),
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

function mapOperationalAppointment(
  appointment: Appointment & { service: { publicName: string } | null },
): OperationalAppointmentDto {
  return {
    ...mapAppointment(appointment),
    clientId: appointment.clientId ?? null,
  };
}

async function reloadOperationalAppointmentDto(
  id: string,
): Promise<OperationalAppointmentDto> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true },
  });
  if (!appointment) {
    throw new AppointmentValidationError("Запись не найдена");
  }
  return mapOperationalAppointment(appointment);
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
        status: true,
        ...APPOINTMENT_BUSY_TIMING_SELECT,
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

async function assertNoBlockingConflict(
  db: AppointmentConflictDbClient,
  input: AppointmentWriteInput,
  excludeAppointmentId?: string,
  writeOptions?: {
    allowAppointmentOverlap?: boolean;
  },
) {
  const startsAt = parseStudioDateTime(input.dateKey, input.startTime);
  // endTime is always desired free-at for conflict checks.
  const desiredFreeAt = parseStudioDateTime(input.dateKey, input.endTime);

  if (desiredFreeAt <= startsAt) {
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
      ...toBusyTimingSnapshot(appointment),
      status: appointment.status,
    })),
    scheduleBlocks: context.scheduleBlocks.map((block) => ({
      startsAt: block.startsAt ?? getEpochDate(),
      endsAt: block.endsAt ?? getEpochDate(),
      isFullDay: block.isFullDay,
    })),
    candidateInterval: {
      startsAt,
      endsAt: desiredFreeAt,
      breakAfterMinutes: 0,
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

export type CreateAppointmentOptions = {
  /** Только ручной create: строго true разрешает overlap с другой записью мастера. */
  allowAppointmentOverlap?: boolean;
};

export type UpdateAppointmentOptions = {
  /**
   * Только ручной PATCH при смене тайминга или активации блокирующего статуса:
   * строго true разрешает appointment-overlap.
   * Авто-allow без confirm — только если тайминг не менялся и запись
   * уже была и остаётся блокирующей (не RESCHEDULED/CANCELLED → active).
   */
  allowAppointmentOverlap?: boolean;
  /** Явный повтор CRM-привязки для COMPLETED (не через autosave полей). */
  retryClientLink?: boolean;
};

export async function createAppointment(
  input: AppointmentWriteInput,
  createdByUserId: string,
  options?: CreateAppointmentOptions,
): Promise<AppointmentMutationResult> {
  const result = await createAppointmentRecord(input, createdByUserId, {
    allowAppointmentOverlap: options?.allowAppointmentOverlap === true,
  });

  const shouldSync = result.appointment.statusCode === "COMPLETED";
  const clientLink = shouldSync
    ? await syncCompletedAppointmentClientLink(result.appointment.id)
    : ({ status: "not_applicable" } satisfies AppointmentClientLinkResult);

  const appointment = await reloadOperationalAppointmentDto(
    result.appointment.id,
  );

  return { appointment, clientLink };
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
    const desiredFreeAt = parseStudioDateTime(input.dateKey, input.endTime);

    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(desiredFreeAt.getTime())
    ) {
      throw new AppointmentValidationError("Некорректные дата или время записи");
    }

    if (desiredFreeAt <= startsAt) {
      throw new AppointmentValidationError("Окончание должно быть позже начала");
    }

    const serviceTiming = await resolveServiceTimingForMaster(
      input.masterId,
      input.serviceId!,
    );

    let timingWrite;
    try {
      timingWrite = buildAppointmentTimingWriteData({
        startsAt,
        desiredFreeAt,
        standardDurationMinutes: serviceTiming?.durationMinutes ?? null,
        standardBreakAfterMinutes: serviceTiming?.breakAfterMinutes ?? null,
        breakAfterMinutes: serviceTiming?.breakAfterMinutes ?? 0,
        existing: null,
      });
    } catch (error) {
      rethrowTimingValidation(error);
    }

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
      endsAt: timingWrite.endsAt,
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
      serviceDurationMinutes: timingWrite.serviceDurationMinutes,
      breakAfterMinutes: timingWrite.breakAfterMinutes,
      standardDurationMinutes: timingWrite.standardDurationMinutes,
      standardBreakAfterMinutes: timingWrite.standardBreakAfterMinutes,
      isManualTimeOverride: timingWrite.isManualTimeOverride,
      timingSemanticsVersion: timingWrite.timingSemanticsVersion,
      timingCanonicalStoredAt: timingWrite.timingCanonicalStoredAt,
    };

    if (process.env.NODE_ENV !== "production") {
      safeLogError("[appointment.create] payload", null, {
        masterId: input.masterId,
        serviceId: input.serviceId,
        startsAt: startsAt.toISOString(),
        endsAt: timingWrite.endsAt.toISOString(),
        desiredFreeAt: desiredFreeAt.toISOString(),
        status: input.status,
        source: input.source,
        appliedPromotionsCount: input.appliedPromotions?.length ?? 0,
        serviceDurationMinutes: timingWrite.serviceDurationMinutes,
        breakAfterMinutes: timingWrite.breakAfterMinutes,
        timingSemanticsVersion: timingWrite.timingSemanticsVersion,
        hasManageTokenHash: Boolean(manageTokenHash),
        // Never log issuedManageToken / raw manageToken
      });
    }

    const appointment = await runSerializableAppointmentWrite(async (tx) => {
      if (input.clientId) {
        try {
          await assertLinkableClientForAppointment(input.clientId, tx);
        } catch {
          throw new AppointmentValidationError(
            "Выбранный клиент недоступен для привязки",
          );
        }
      }

      // input.endTime is desired free-at; candidate breakAfterMinutes = 0.
      await assertNoBlockingConflict(tx, input, undefined, {
        allowAppointmentOverlap: options?.allowAppointmentOverlap === true,
      });

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
    if (error instanceof AppointmentTimingValidationError) {
      const validationError = new AppointmentValidationError(error.message);
      logServiceError("appointment.create", validationError);
      throw validationError;
    }
    logServiceError("appointment.create", error);
    throw error;
  }
}

export async function updateAppointment(
  id: string,
  input: Partial<AppointmentWriteInput>,
  options?: UpdateAppointmentOptions,
): Promise<AppointmentMutationResult> {
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

  const retryOnly =
    options?.retryClientLink === true &&
    Object.keys(input).length === 0;

  if (retryOnly) {
    if (existing.status !== "COMPLETED") {
      throw new AppointmentValidationError(
        "Повторная привязка доступна только для выполненной записи",
      );
    }
    const clientLink = await syncCompletedAppointmentClientLink(id);
    const appointment = await reloadOperationalAppointmentDto(id);
    return { appointment, clientLink };
  }

  const existingSnapshot = toBusyTimingSnapshot(existing);
  const currentBusyEnd = getAppointmentBusyInterval(existingSnapshot).endsAt;

  const merged: AppointmentWriteInput = {
    masterId: input.masterId ?? existing.masterId,
    dateKey: input.dateKey ?? formatDateKeyInStudio(existing.startsAt),
    startTime: input.startTime ?? formatStudioTimeInput(existing.startsAt),
    endTime:
      input.endTime !== undefined
        ? input.endTime
        : formatStudioTimeInput(currentBusyEnd),
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

  const desiredStartsAt = parseStudioDateTime(merged.dateKey, merged.startTime);
  const desiredFreeAt = parseStudioDateTime(merged.dateKey, merged.endTime);

  if (desiredFreeAt <= desiredStartsAt) {
    throw new AppointmentValidationError("Окончание должно быть позже начала");
  }

  const timingDirty = isAppointmentTimingDirty({
    current: existingSnapshot,
    currentServiceId: existing.serviceId,
    currentMasterId: existing.masterId,
    currentDateKey: formatDateKeyInStudio(existing.startsAt),
    desiredStartsAt,
    desiredFreeAt,
    desiredServiceId: merged.serviceId ?? null,
    desiredMasterId: merged.masterId,
    desiredDateKey: merged.dateKey,
  });

  const nonTimingData: Prisma.AppointmentUpdateInput = {
    service:
      merged.serviceId != null
        ? { connect: { id: merged.serviceId } }
        : { disconnect: true },
    clientName: merged.clientName.trim(),
    clientPhone: merged.clientPhone.trim(),
    comment: merged.comment?.trim() || null,
    importantNote: assertValidMasterNote(merged.importantNote),
    isBold: merged.isBold ?? false,
    status: merged.status,
    source: merged.source,
  };

  const hasClientIdChange = Object.prototype.hasOwnProperty.call(
    input,
    "clientId",
  );

  let data: Prisma.AppointmentUpdateInput = nonTimingData;

  if (timingDirty) {
    const serviceTiming = merged.serviceId
      ? await resolveServiceTimingForMaster(merged.masterId, merged.serviceId)
      : null;

    let timingWrite;
    try {
      timingWrite = buildAppointmentTimingWriteData({
        startsAt: desiredStartsAt,
        desiredFreeAt,
        standardDurationMinutes: serviceTiming?.durationMinutes ?? null,
        standardBreakAfterMinutes: serviceTiming?.breakAfterMinutes ?? null,
        breakAfterMinutes: serviceTiming?.breakAfterMinutes ?? 0,
        existing: existingSnapshot,
        isUpdate: true,
      });
    } catch (error) {
      rethrowTimingValidation(error);
    }

    data = {
      ...nonTimingData,
      master: { connect: { id: merged.masterId } },
      startsAt: desiredStartsAt,
      endsAt: timingWrite.endsAt,
      serviceDurationMinutes: timingWrite.serviceDurationMinutes,
      breakAfterMinutes: timingWrite.breakAfterMinutes,
      standardDurationMinutes: timingWrite.standardDurationMinutes,
      standardBreakAfterMinutes: timingWrite.standardBreakAfterMinutes,
      isManualTimeOverride: timingWrite.isManualTimeOverride,
      timingSemanticsVersion: timingWrite.timingSemanticsVersion,
      timingCanonicalStoredAt: timingWrite.timingCanonicalStoredAt,
    };
  }

  const needsConflictCheck = isBlockingAppointmentStatus(merged.status);
  const wasBlocking = isBlockingAppointmentStatus(existing.status);
  const willBeBlocking = needsConflictCheck;
  // Авто-allow только для уже занятого слота: тайминг не менялся и статус
  // остаётся блокирующим. Активация RESCHEDULED/CANCELLED → blocking
  // требует явного allowAppointmentOverlap (как смена времени).
  const allowAppointmentOverlap =
    options?.allowAppointmentOverlap === true ||
    (!timingDirty && wasBlocking && willBeBlocking);

  async function applyClientLinkAndUpdate(
    tx: Prisma.TransactionClient,
  ): Promise<Appointment & { service: { publicName: string } | null }> {
    const writeData: Prisma.AppointmentUpdateInput = { ...data };

    if (hasClientIdChange) {
      if (input.clientId === null) {
        writeData.client = { disconnect: true };
      } else if (typeof input.clientId === "string" && input.clientId.trim()) {
        try {
          await assertLinkableClientForAppointment(input.clientId.trim(), tx);
        } catch {
          throw new AppointmentValidationError(
            "Выбранный клиент недоступен для привязки",
          );
        }
        writeData.client = { connect: { id: input.clientId.trim() } };
      }
    }

    return tx.appointment.update({
      where: { id },
      data: writeData,
      include: { service: true },
    });
  }

  const appointment = needsConflictCheck
    ? await runSerializableAppointmentWrite(async (tx) => {
        // merged.endTime is desired free-at; candidate breakAfterMinutes = 0.
        // excludeAppointmentId = id — запись не конфликтует сама с собой.
        await assertNoBlockingConflict(tx, merged, id, {
          allowAppointmentOverlap,
        });

        return applyClientLinkAndUpdate(tx);
      })
    : hasClientIdChange
      ? await prisma.$transaction(async (tx) => applyClientLinkAndUpdate(tx))
      : await prisma.appointment.update({
          where: { id },
          data,
          include: { service: true },
        });

  const becameCompleted =
    existing.status !== "COMPLETED" && appointment.status === "COMPLETED";
  const hasExplicitClientConnect =
    hasClientIdChange &&
    typeof input.clientId === "string" &&
    input.clientId.trim().length > 0;
  const shouldSync =
    becameCompleted ||
    (options?.retryClientLink === true && appointment.status === "COMPLETED") ||
    (appointment.status === "COMPLETED" && hasExplicitClientConnect);

  const clientLink = shouldSync
    ? await syncCompletedAppointmentClientLink(appointment.id)
    : ({ status: "not_applicable" } satisfies AppointmentClientLinkResult);

  const appointmentDto =
    clientLink.status === "created" ||
    clientLink.status === "linked" ||
    clientLink.status === "already_linked" ||
    hasClientIdChange
      ? await reloadOperationalAppointmentDto(appointment.id)
      : mapOperationalAppointment(appointment);

  return { appointment: appointmentDto, clientLink };
}

export async function cancelAppointment(
  id: string,
): Promise<OperationalAppointmentDto> {
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { service: true },
  });

  if (!existing) {
    throw new AppointmentValidationError("Запись не найдена");
  }

  if (existing.status === "CANCELLED") {
    return mapOperationalAppointment(existing);
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: getStudioNow(),
    },
    include: { service: true },
  });

  return mapOperationalAppointment(appointment);
}

export {
  mapAppointment as mapAppointmentDto,
  mapOperationalAppointment as mapOperationalAppointmentDto,
};
