import {
  AppointmentCreatorKind,
  AppointmentSource,
  AppointmentStatus,
  Prisma,
  type Appointment,
} from "@prisma/client";
export { creatorKindFromAuthenticatedRole } from "@/lib/schedule/appointment-creator-kind";
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
import type { SiteAttribution } from "@/lib/attribution/site-attribution";
import { EMPTY_SITE_ATTRIBUTION } from "@/lib/attribution/site-attribution";
import { createAppointmentSiteAttribution } from "@/services/SiteAttributionService";
import { claimAcquisitionEvidenceForAppointment } from "@/services/AcquisitionAttributionService";
import { applyTrustedSourceMarker } from "@/lib/attribution/trusted-acquisition";
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
import {
  assertWritableIdNotExplicitlyCleared,
  lockAndAssertAppointmentServicePolicy,
  MASTER_ID_REQUIRED_MESSAGE,
  MASTER_SERVICE_ID_REQUIRED_MESSAGE,
  MasterServiceAssignmentError,
  shouldValidateMasterServiceAssignment,
  type AppointmentServicePolicy,
} from "@/lib/schedule/master-service-assignment";

export {
  resolveAppointmentWriteConflict,
  type AppointmentConflictCode,
  type AppointmentConflictType,
  type AppointmentWriteConflict,
} from "@/lib/schedule/appointment-write-conflicts";

export type { AppointmentClientLinkResult };

export { AppointmentCreatorKind };

/** Максимум попыток Serializable-транзакции при serialization failure. */
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

export function rethrowMasterServiceAssignment(error: unknown): never {
  if (error instanceof MasterServiceAssignmentError) {
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

/**
 * Retryable serialization conflicts for appointment Serializable writes.
 * - P2034: Prisma write-conflict / serialization failure
 * - P2010 + meta.code 40001: raw SQL serialization_failure (SQLSTATE)
 * Does not use message text; other P2010 / unknown errors are not retryable.
 */
export function isAppointmentSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === "P2034") {
    return true;
  }
  if (error.code === "P2010") {
    return error.meta?.code === "40001";
  }
  return false;
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

export type AppointmentServiceRuntime = {
  db: Pick<Prisma.TransactionClient, "appointment">;
  runSerializableWrite: typeof runSerializableAppointmentWrite;
  resolveServiceTiming: typeof resolveServiceTimingForMaster;
  recordPublicAcceptances: typeof recordRequiredPublicFormAcceptances;
  syncCompletedClientLink: typeof syncCompletedAppointmentClientLink;
};

const DEFAULT_APPOINTMENT_SERVICE_RUNTIME: AppointmentServiceRuntime = {
  db: prisma,
  runSerializableWrite: runSerializableAppointmentWrite,
  resolveServiceTiming: resolveServiceTimingForMaster,
  recordPublicAcceptances: recordRequiredPublicFormAcceptances,
  syncCompletedClientLink: syncCompletedAppointmentClientLink,
};

/** Узкая DI-seam для runtime/DB regression tests; HTTP payload её не контролирует. */
export function createAppointmentServiceRuntime(
  overrides: Partial<AppointmentServiceRuntime> = {},
): AppointmentServiceRuntime {
  return { ...DEFAULT_APPOINTMENT_SERVICE_RUNTIME, ...overrides };
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
  /**
   * Писать LegalAcceptanceRecord в той же транзакции.
   * ONLINE → ONLINE_BOOKING; BOT → BOT. Не использовать для INTERNAL.
   */
  recordPublicLegalAcceptances?: boolean;
  /** Immutable browser-observed provenance; accepted only by the ONLINE entrypoint. */
  siteAttribution?: SiteAttribution;
  /**
   * Opaque one-time acquisition evidence bearer. Claimed only inside the
   * ONLINE create transaction — never trusted from a pre-TX lookup.
   */
  acquisitionEvidenceToken?: string | null;
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
  /** Creator provenance; null for legacy / unproven rows. */
  creatorKind: AppointmentCreatorKind | null;
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
    creatorKind: appointment.creatorKind ?? null,
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
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
): Promise<OperationalAppointmentDto> {
  const appointment = await runtime.db.appointment.findUnique({
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
  /**
   * Creator provenance from authenticated actor (admin route / trusted caller).
   * Required — never defaulted; never taken from client body.
   */
  creatorKind: AppointmentCreatorKind;
};

type CreateAppointmentRecordOptions = CreateAppointmentOptions & {
  /** Выбирается только серверным entrypoint, не принимается из HTTP payload. */
  servicePolicy: AppointmentServicePolicy;
  /** Server-side only; never from HTTP body. */
  creatorKind: AppointmentCreatorKind;
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
  options: CreateAppointmentOptions,
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
): Promise<AppointmentMutationResult> {
  if (options.creatorKind == null) {
    throw new AppointmentValidationError(
      "creatorKind is required for appointment create",
    );
  }
  const result = await createAppointmentRecord(input, createdByUserId, {
    allowAppointmentOverlap: options.allowAppointmentOverlap === true,
    servicePolicy: "INTERNAL",
    creatorKind: options.creatorKind,
  }, runtime);

  const shouldSync = result.appointment.statusCode === "COMPLETED";
  const clientLink = shouldSync
    ? await runtime.syncCompletedClientLink(result.appointment.id)
    : ({ status: "not_applicable" } satisfies AppointmentClientLinkResult);

  const appointment = await reloadOperationalAppointmentDto(
    result.appointment.id,
    runtime,
  );

  return { appointment, clientLink };
}

export async function createOnlineAppointment(
  input: Omit<AppointmentWriteInput, "status" | "source"> & {
    serviceId: string;
  },
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
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
    {
      servicePolicy: "PUBLIC_ONLINE",
      creatorKind: AppointmentCreatorKind.SELF_SERVICE,
    },
    runtime,
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

/**
 * Confirmed self-booking from internal bot S2S (CURSOR-24) or master command.
 * Same PUBLIC_ONLINE policy / overlap / timing as online create;
 * source=BOT, no manage token, legal source BOT.
 * Creator provenance is explicit (TEYA vs MASTER) — not inferred from source=BOT.
 */
export async function createBotOnlineAppointment(
  input: Omit<AppointmentWriteInput, "status" | "source"> & {
    serviceId: string;
  },
  creatorKind:
    | typeof AppointmentCreatorKind.TEYA
    | typeof AppointmentCreatorKind.MASTER,
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
): Promise<{ appointment: AppointmentDto }> {
  const result = await createAppointmentRecord(
    {
      ...input,
      status: "SCHEDULED",
      source: "BOT",
      recordPublicLegalAcceptances: true,
    },
    null,
    { servicePolicy: "PUBLIC_ONLINE", creatorKind },
    runtime,
  );

  if (result.issuedManageToken) {
    throw new AppointmentValidationError(
      "BOT booking must not issue manage token",
    );
  }

  return { appointment: result.appointment };
}

/**
 * Book-from-request path for internal bot S2S (BookingRequest contour).
 * INTERNAL service policy (active + masterService enabled only — no online flags),
 * source=BOT, no manage token, no public legal acceptances.
 */
export async function createBotRequestAppointment(
  input: Omit<
    AppointmentWriteInput,
    "status" | "source" | "recordPublicLegalAcceptances"
  > & {
    serviceId: string;
  },
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
): Promise<{ appointment: AppointmentDto }> {
  const result = await createAppointmentRecord(
    {
      ...input,
      status: "SCHEDULED",
      source: "BOT",
    },
    null,
    {
      servicePolicy: "INTERNAL",
      creatorKind: AppointmentCreatorKind.TEYA,
    },
    runtime,
  );

  if (result.issuedManageToken) {
    throw new AppointmentValidationError(
      "BOT booking must not issue manage token",
    );
  }

  return { appointment: result.appointment };
}

type AppointmentCreateRecordResult = {
  appointment: AppointmentDto;
  issuedManageToken: string | null;
};

async function createAppointmentRecord(
  input: AppointmentWriteInput,
  createdByUserId: string | null,
  options: CreateAppointmentRecordOptions,
  runtime: AppointmentServiceRuntime,
): Promise<AppointmentCreateRecordResult> {
  try {
    try {
      assertWritableIdNotExplicitlyCleared({
        fieldPresent: true,
        value: input.masterId,
        emptyMessage: MASTER_ID_REQUIRED_MESSAGE,
      });
      assertWritableIdNotExplicitlyCleared({
        fieldPresent: true,
        value: input.serviceId,
        emptyMessage: MASTER_SERVICE_ID_REQUIRED_MESSAGE,
      });
    } catch (error) {
      rethrowMasterServiceAssignment(error);
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

    const serviceTiming = await runtime.resolveServiceTiming(
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

    if (input.source === "BOT" && (issuedManageToken || manageTokenHash)) {
      throw new AppointmentValidationError(
        "BOT booking must not issue manage token",
      );
    }

    const publicRequestReference =
      input.recordPublicLegalAcceptances &&
      (input.source === "ONLINE" || input.source === "BOT")
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
      creatorKind: options.creatorKind,
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
        creatorKind: options.creatorKind,
        appliedPromotionsCount: input.appliedPromotions?.length ?? 0,
        serviceDurationMinutes: timingWrite.serviceDurationMinutes,
        breakAfterMinutes: timingWrite.breakAfterMinutes,
        timingSemanticsVersion: timingWrite.timingSemanticsVersion,
        hasManageTokenHash: Boolean(manageTokenHash),
        // Never log issuedManageToken / raw manageToken
      });
    }

    const appointment = await runtime.runSerializableWrite(async (tx) => {
      if (input.clientId) {
        try {
          await assertLinkableClientForAppointment(input.clientId, tx);
        } catch (error) {
          // Preserve SSI failures so Serializable retries still apply.
          if (isAppointmentSerializationFailure(error)) {
            throw error;
          }
          throw new AppointmentValidationError(
            "Выбранный клиент недоступен для привязки",
          );
        }
      }

      // input.endTime is desired free-at; candidate breakAfterMinutes = 0.
      await assertNoBlockingConflict(tx, input, undefined, {
        allowAppointmentOverlap: options?.allowAppointmentOverlap === true,
      });

      let created;
      try {
        created = await createAppointmentWithValidatedServicePolicy(tx, {
          masterId: input.masterId,
          serviceId: input.serviceId!,
          policy: options.servicePolicy,
          data: createPayload,
        });
      } catch (error) {
        rethrowMasterServiceAssignment(error);
      }

      if (input.recordPublicLegalAcceptances) {
        if (input.source === "ONLINE") {
          await runtime.recordPublicAcceptances(tx, {
            source: "ONLINE_BOOKING",
            appointmentId: created.id,
            clientId: input.clientId ?? null,
            requestReference: publicRequestReference,
          });
        } else if (input.source === "BOT") {
          await runtime.recordPublicAcceptances(tx, {
            source: "BOT",
            appointmentId: created.id,
            clientId: input.clientId ?? null,
            requestReference: publicRequestReference,
          });
        }
      }

      if (input.source === "ONLINE") {
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          input.acquisitionEvidenceToken,
          created.id,
        );
        await createAppointmentSiteAttribution(
          tx,
          created.id,
          applyTrustedSourceMarker(
            input.siteAttribution ?? EMPTY_SITE_ATTRIBUTION,
            claimed?.sourceKey ?? null,
          ),
        );
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

    if (
      input.source === "BOT" &&
      (appointment.manageTokenHash || appointment.manageToken)
    ) {
      throw new AppointmentValidationError(
        "BOT booking must not persist manage token",
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

type AppointmentPolicyWriteTx = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "appointment"
>;

/**
 * Production orchestration point: policy lock и create используют один tx,
 * причём lock выполняется непосредственно перед write.
 */
async function createAppointmentWithValidatedServicePolicy(
  tx: AppointmentPolicyWriteTx,
  input: {
    masterId: string;
    serviceId: string;
    policy: AppointmentServicePolicy;
    data: Prisma.AppointmentCreateInput;
  },
): Promise<Appointment & { service: { publicName: string } | null }> {
  await lockAndAssertAppointmentServicePolicy(tx, {
    masterId: input.masterId,
    serviceId: input.serviceId,
    policy: input.policy,
  });

  return tx.appointment.create({
    data: input.data,
    include: { service: true },
  });
}

async function lockAndLoadAppointmentForUpdate(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<(Appointment & { service: { publicName: string } | null }) | null> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a."id"
    FROM "appointments" AS a
    WHERE a."id" = ${id}::uuid
    FOR UPDATE OF a
  `);
  if (locked.length === 0) {
    return null;
  }

  return tx.appointment.findUnique({
    where: { id },
    include: { service: true },
  });
}

export async function updateAppointment(
  id: string,
  input: Partial<AppointmentWriteInput>,
  options?: UpdateAppointmentOptions,
  runtime: AppointmentServiceRuntime = DEFAULT_APPOINTMENT_SERVICE_RUNTIME,
): Promise<AppointmentMutationResult> {
  const hasMasterIdField = Object.prototype.hasOwnProperty.call(
    input,
    "masterId",
  );
  const hasServiceIdField = Object.prototype.hasOwnProperty.call(
    input,
    "serviceId",
  );
  const hasClientIdChange = Object.prototype.hasOwnProperty.call(
    input,
    "clientId",
  );
  const retryOnly =
    options?.retryClientLink === true && Object.keys(input).length === 0;

  try {
    assertWritableIdNotExplicitlyCleared({
      fieldPresent: hasMasterIdField,
      value: input.masterId,
      emptyMessage: MASTER_ID_REQUIRED_MESSAGE,
    });
    assertWritableIdNotExplicitlyCleared({
      fieldPresent: hasServiceIdField,
      value: input.serviceId,
      emptyMessage: MASTER_SERVICE_ID_REQUIRED_MESSAGE,
    });
  } catch (error) {
    rethrowMasterServiceAssignment(error);
  }

  const transactionResult = await runtime.runSerializableWrite(async (tx) => {
    const existing = await lockAndLoadAppointmentForUpdate(tx, id);
    if (!existing) {
      throw new AppointmentValidationError("Запись не найдена");
    }
    if (existing.status === "CANCELLED") {
      throw new AppointmentValidationError(
        "Запись уже отменена и не может быть изменена",
      );
    }
    if (retryOnly) {
      if (existing.status !== "COMPLETED") {
        throw new AppointmentValidationError(
          "Повторная привязка доступна только для выполненной записи",
        );
      }
      return { appointment: existing, existing };
    }

    const existingSnapshot = toBusyTimingSnapshot(existing);
    const currentBusyEnd = getAppointmentBusyInterval(existingSnapshot).endsAt;
    const merged: AppointmentWriteInput = {
      masterId: hasMasterIdField
        ? (input.masterId as string)
        : existing.masterId,
      dateKey: input.dateKey ?? formatDateKeyInStudio(existing.startsAt),
      startTime: input.startTime ?? formatStudioTimeInput(existing.startsAt),
      endTime:
        input.endTime !== undefined
          ? input.endTime
          : formatStudioTimeInput(currentBusyEnd),
      serviceId: hasServiceIdField
        ? (input.serviceId as string)
        : existing.serviceId,
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

    const desiredStartsAt = parseStudioDateTime(
      merged.dateKey,
      merged.startTime,
    );
    const desiredFreeAt = parseStudioDateTime(merged.dateKey, merged.endTime);
    if (desiredFreeAt <= desiredStartsAt) {
      throw new AppointmentValidationError("Окончание должно быть позже начала");
    }

    const needsAssignmentCheck = shouldValidateMasterServiceAssignment({
      isCreate: false,
      existingMasterId: existing.masterId,
      existingServiceId: existing.serviceId,
      desiredMasterId: merged.masterId,
      desiredServiceId: merged.serviceId,
    });
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

    let data: Prisma.AppointmentUpdateInput = {
      ...(merged.masterId !== existing.masterId
        ? { master: { connect: { id: merged.masterId } } }
        : {}),
      ...(merged.serviceId !== existing.serviceId
        ? {
            service:
              merged.serviceId != null
                ? { connect: { id: merged.serviceId } }
                : { disconnect: true },
          }
        : {}),
      clientName: merged.clientName.trim(),
      clientPhone: merged.clientPhone.trim(),
      comment: merged.comment?.trim() || null,
      importantNote: assertValidMasterNote(merged.importantNote),
      isBold: merged.isBold ?? false,
      status: merged.status,
      source: merged.source,
    };

    if (timingDirty) {
      const serviceTiming = merged.serviceId
        ? await runtime.resolveServiceTiming(merged.masterId, merged.serviceId)
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
        ...data,
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

    if (hasClientIdChange) {
      if (input.clientId === null) {
        data.client = { disconnect: true };
      } else if (typeof input.clientId === "string" && input.clientId.trim()) {
        try {
          await assertLinkableClientForAppointment(input.clientId.trim(), tx);
        } catch (error) {
          if (isAppointmentSerializationFailure(error)) {
            throw error;
          }
          throw new AppointmentValidationError(
            "Выбранный клиент недоступен для привязки",
          );
        }
        data.client = { connect: { id: input.clientId.trim() } };
      }
    }

    const needsConflictCheck = isBlockingAppointmentStatus(merged.status);
    const wasBlocking = isBlockingAppointmentStatus(existing.status);
    const willBeBlocking = needsConflictCheck;
    const allowAppointmentOverlap =
      options?.allowAppointmentOverlap === true ||
      (!timingDirty && wasBlocking && willBeBlocking);
    if (needsConflictCheck) {
      await assertNoBlockingConflict(tx, merged, id, {
        allowAppointmentOverlap,
      });
    }

    if (needsAssignmentCheck) {
      try {
        await lockAndAssertAppointmentServicePolicy(tx, {
          masterId: merged.masterId,
          serviceId: merged.serviceId!,
          policy: "INTERNAL",
        });
      } catch (error) {
        rethrowMasterServiceAssignment(error);
      }
    }

    const appointment = await tx.appointment.update({
      where: { id },
      data,
      include: { service: true },
    });
    return { appointment, existing };
  });

  if (retryOnly) {
    const clientLink = await runtime.syncCompletedClientLink(id);
    const appointment = await reloadOperationalAppointmentDto(id, runtime);
    return { appointment, clientLink };
  }

  const { appointment, existing } = transactionResult;
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
    ? await runtime.syncCompletedClientLink(appointment.id)
    : ({ status: "not_applicable" } satisfies AppointmentClientLinkResult);
  const appointmentDto =
    clientLink.status === "created" ||
    clientLink.status === "linked" ||
    clientLink.status === "already_linked" ||
    hasClientIdChange
      ? await reloadOperationalAppointmentDto(appointment.id, runtime)
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
