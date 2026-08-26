/**
 * CURSOR-26 — Master Command orchestration (schedule + owned mutations + booking).
 * Reuses Serializable appointment write, ScheduleBlock/ExtraWorkWindow domain, bot booking path.
 */
import "server-only";

import type { Prisma as PrismaNs } from "@prisma/client";
import { BotIdempotencyHmacConfigError } from "@/lib/bot-api/booking-create-idempotency-hmac";
import {
  claimMasterBookingCreateIdempotency,
  claimMasterCloseDayIdempotency,
  claimMasterCloseIntervalIdempotency,
  claimMasterDeleteBlockIdempotency,
  claimMasterExtraWorkCreateIdempotency,
  claimMasterExtraWorkDeleteIdempotency,
  computeMasterBookingCreateFingerprint,
  computeMasterCloseDayFingerprint,
  computeMasterCloseIntervalFingerprint,
  computeMasterDeleteBlockFingerprint,
  computeMasterExtraWorkCreateFingerprint,
  computeMasterExtraWorkDeleteFingerprint,
  markMasterCommandIdempotencyFailure,
  type MasterClaimResult,
  type SafeMasterBlockSnapshot,
  type SafeMasterBookingSnapshot,
  type SafeMasterDeleteSnapshot,
  type SafeMasterExtraWorkDeleteSnapshot,
  type SafeMasterExtraWorkSnapshot,
} from "@/lib/bot-api/master-command-idempotency";
import type {
  MasterBookingCreateRequest,
  MasterCloseDayRequest,
  MasterCloseIntervalRequest,
  MasterCommandErrorCode,
  MasterDeleteBlockRequest,
  MasterExtraWorkCreateRequest,
  MasterExtraWorkDeleteRequest,
  MasterScheduleReadRequest,
} from "@/lib/bot-api/master-command-types";
import {
  masterCommandDefaultHttpStatus,
  masterCommandFixedErrorMessage,
} from "@/lib/bot-api/master-command-types";
import { parseBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  assertPublicMorningSlotAllowed,
  PublicMorningSlotCutoffError,
} from "@/lib/booking/public-morning-slot-cutoff";
import {
  addDaysToDateKey,
  addMinutesSafe,
  formatStudioDateKey,
  formatStudioOffsetDateTime,
  formatStudioTimeInput,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";
import {
  normalizePhone,
  resolveClientPhoneMatchKey,
} from "@/lib/phone/normalize-phone";
import { mapScheduleDayAppointmentMaster } from "@/lib/schedule/map-schedule-appointment";
import { activeScheduleAppointmentWhere } from "@/lib/schedule/non-blocking-appointment-statuses";
import { getBlockDisplayLabel } from "@/lib/schedule/labels";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointmentServiceRuntime,
  createBotOnlineAppointment,
  runSerializableAppointmentWrite,
} from "@/services/AppointmentService";
import {
  assertOnlineBookable,
  getAvailableTimeSlots,
  OnlineServiceUnavailableError,
} from "@/services/BookingService";
import { createClientFromLead } from "@/services/ClientLinkService";
import {
  createExtraWorkWindowWithDb,
  deleteOwnedMasterExtraWorkWindow,
  ExtraWorkInUseError,
  ExtraWorkOwnershipError,
  ExtraWorkValidationError,
} from "@/services/ExtraWorkWindowService";
import { assertRequiredLegalDocumentsPublished } from "@/services/LegalDocumentService";
import {
  blocksForDayWhere,
  createScheduleBlockWithDb,
  deleteOwnedMasterScheduleBlock,
  ScheduleBlockConflictError,
  ScheduleBlockOwnershipError,
  ScheduleBlockValidationError,
} from "@/services/ScheduleBlockService";

import {
  clearMasterCommandTestHooks,
  createCountdownBarrier,
  getMasterCommandTestHooks,
  setMasterCommandTestHooks,
} from "@/lib/bot-api/master-command-test-hooks";

export {
  clearMasterCommandTestHooks,
  createCountdownBarrier,
  setMasterCommandTestHooks,
};

export type MasterCommandResult<T> =
  | { ok: true; body: T }
  | {
      ok: false;
      code: MasterCommandErrorCode;
      error: string;
      httpStatus: number;
    };

export class MasterCommandError extends Error {
  readonly code: MasterCommandErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly finalForIdempotency: boolean;

  constructor(
    code: MasterCommandErrorCode,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      finalForIdempotency?: boolean;
    },
  ) {
    super(masterCommandFixedErrorMessage(code));
    this.name = "MasterCommandError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? masterCommandDefaultHttpStatus(code);
    this.retryable = options?.retryable ?? code === "INTERNAL_ERROR";
    this.finalForIdempotency =
      options?.finalForIdempotency ??
      (code !== "INTERNAL_ERROR" &&
        code !== "IDEMPOTENCY_IN_PROGRESS" &&
        code !== "RATE_LIMITED");
  }
}

function failResult(code: MasterCommandErrorCode): MasterCommandResult<never> {
  return {
    ok: false,
    code,
    error: masterCommandFixedErrorMessage(code),
    httpStatus: masterCommandDefaultHttpStatus(code),
  };
}

/** Typed domain → machine-readable Master Command errors (no message substrings). */
export function mapMasterCommandDomainFailure(error: unknown): MasterCommandError {
  if (error instanceof MasterCommandError) return error;
  if (error instanceof ScheduleBlockConflictError) {
    if (
      error.code === "APPOINTMENT_OVERLAP" ||
      error.code === "DAY_HAS_APPOINTMENTS"
    ) {
      return new MasterCommandError("APPOINTMENT_CONFLICT", {
        finalForIdempotency: true,
      });
    }
    return new MasterCommandError("BLOCK_CONFLICT", { finalForIdempotency: true });
  }
  if (error instanceof ScheduleBlockOwnershipError) {
    return new MasterCommandError("BLOCK_NOT_OWNED", { finalForIdempotency: true });
  }
  if (error instanceof ScheduleBlockValidationError) {
    if (error.code === "NOT_FOUND") {
      return new MasterCommandError("BLOCK_NOT_FOUND", { finalForIdempotency: true });
    }
    return new MasterCommandError("VALIDATION_ERROR", { finalForIdempotency: true });
  }
  if (error instanceof ExtraWorkOwnershipError) {
    return new MasterCommandError("EXTRA_WORK_NOT_OWNED", {
      finalForIdempotency: true,
    });
  }
  if (error instanceof ExtraWorkInUseError) {
    return new MasterCommandError("EXTRA_WORK_IN_USE", { finalForIdempotency: true });
  }
  if (error instanceof ExtraWorkValidationError) {
    if (error.code === "NOT_FOUND") {
      return new MasterCommandError("EXTRA_WORK_NOT_FOUND", {
        finalForIdempotency: true,
      });
    }
    return new MasterCommandError("VALIDATION_ERROR", { finalForIdempotency: true });
  }
  if (error instanceof PublicMorningSlotCutoffError) {
    return new MasterCommandError("SLOT_NO_LONGER_AVAILABLE", {
      finalForIdempotency: true,
    });
  }
  if (error instanceof AppointmentConflictError) {
    return new MasterCommandError("SLOT_NO_LONGER_AVAILABLE", {
      finalForIdempotency: true,
    });
  }
  if (error instanceof OnlineServiceUnavailableError) {
    return new MasterCommandError("SERVICE_UNAVAILABLE", {
      finalForIdempotency: true,
    });
  }
  if (error instanceof AppointmentValidationError) {
    return new MasterCommandError("VALIDATION_ERROR", { finalForIdempotency: true });
  }
  if (
    error instanceof Error &&
    error.message === "MASTER_COMMAND_IDEMPOTENCY_SNAPSHOT_INVALID"
  ) {
    return new MasterCommandError("INTERNAL_ERROR", {
      retryable: true,
      finalForIdempotency: false,
    });
  }
  return new MasterCommandError("INTERNAL_ERROR", {
    retryable: true,
    finalForIdempotency: false,
  });
}

async function assertMasterExists(masterId: string): Promise<void> {
  const master = await prisma.master.findUnique({
    where: { id: masterId },
    select: { id: true },
  });
  if (!master) {
    throw new MasterCommandError("MASTER_NOT_FOUND", { finalForIdempotency: true });
  }
}

async function lockIdempotencyRow(
  tx: PrismaNs.TransactionClient,
  operationId: string,
  leaseOwner: string,
  persistedFingerprint: string,
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string; state: string }>>`
    SELECT id, state::text AS state
    FROM internal_bot_booking_operations
    WHERE id = ${operationId}::uuid
    FOR UPDATE
  `;
  const op = locked[0];
  if (!op || op.state !== "IN_PROGRESS") {
    throw new MasterCommandError("IDEMPOTENCY_IN_PROGRESS", {
      finalForIdempotency: false,
      retryable: true,
    });
  }

  const owned = await tx.internalBotBookingOperation.findFirst({
    where: {
      id: operationId,
      leaseOwner,
      requestFingerprint: persistedFingerprint,
      state: "IN_PROGRESS",
    },
    select: { id: true },
  });
  if (!owned) {
    throw new MasterCommandError("IDEMPOTENCY_IN_PROGRESS", {
      finalForIdempotency: false,
      retryable: true,
    });
  }
}

async function handleClaimPhase<TSnapshot, TBody>(
  claim: MasterClaimResult<TSnapshot>,
  toBody: (snapshot: TSnapshot, replay: boolean) => TBody,
): Promise<MasterCommandResult<TBody> | { claimed: true } & Extract<
  MasterClaimResult<TSnapshot>,
  { kind: "claimed" }
>> {
  if (claim.kind === "conflict") return failResult("IDEMPOTENCY_CONFLICT");
  if (claim.kind === "in_progress") return failResult("IDEMPOTENCY_IN_PROGRESS");
  if (claim.kind === "replay_success") {
    return { ok: true, body: toBody(claim.snapshot, true) };
  }
  if (claim.kind === "replay_failure") {
    const code = (
      [
        "VALIDATION_ERROR",
        "MASTER_NOT_FOUND",
        "MASTER_SCOPE_VIOLATION",
        "APPOINTMENT_CONFLICT",
        "BLOCK_CONFLICT",
        "BLOCK_NOT_FOUND",
        "BLOCK_NOT_OWNED",
        "EXTRA_WORK_NOT_FOUND",
        "EXTRA_WORK_NOT_OWNED",
        "EXTRA_WORK_IN_USE",
        "SLOT_INVALID",
        "SLOT_NO_LONGER_AVAILABLE",
        "SERVICE_UNAVAILABLE",
        "MASTER_UNAVAILABLE",
        "SERVICE_MASTER_MISMATCH",
        "CLIENT_AMBIGUOUS",
        "INTERNAL_ERROR",
      ] as MasterCommandErrorCode[]
    ).includes(claim.code as MasterCommandErrorCode)
      ? (claim.code as MasterCommandErrorCode)
      : "INTERNAL_ERROR";
    return failResult(code);
  }
  return { claimed: true, ...claim };
}

async function runClaimedMutation<TSnapshot, TBody>(args: {
  claim: Extract<MasterClaimResult<TSnapshot>, { kind: "claimed" }>;
  fingerprint: string;
  execute: (
    tx: PrismaNs.TransactionClient,
  ) => Promise<TSnapshot>;
  toBody: (snapshot: TSnapshot, replay: boolean) => TBody;
  logScope: string;
}): Promise<MasterCommandResult<TBody>> {
  const { operationId, leaseOwner, persistedFingerprint } = args.claim;
  try {
    await getMasterCommandTestHooks().beforeSerializableWrite?.();
    const snapshot = await runSerializableAppointmentWrite(async (tx) => {
      await lockIdempotencyRow(
        tx,
        operationId,
        leaseOwner,
        persistedFingerprint,
      );
      const result = await args.execute(tx);
      await tx.internalBotBookingOperation.update({
        where: { id: operationId },
        data: {
          state: "SUCCEEDED",
          resultSnapshot: result as object,
          failureCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return result;
    });
    return { ok: true, body: args.toBody(snapshot, false) };
  } catch (error) {
    const mapped = mapMasterCommandDomainFailure(error);
    if (!(error instanceof MasterCommandError)) {
      safeLogError(args.logScope, error);
    }
    try {
      await markMasterCommandIdempotencyFailure(prisma, {
        operationId,
        leaseOwner,
        fingerprint: persistedFingerprint,
        state: mapped.finalForIdempotency
          ? "FAILED_FINAL"
          : "FAILED_RETRYABLE",
        failureCode: mapped.code,
      });
    } catch (markError) {
      safeLogError(`${args.logScope}-idempotency-mark`, markError);
    }
    return failResult(mapped.code);
  }
}

function blockSuccessBody(
  snapshot: SafeMasterBlockSnapshot,
  idempotentReplay: boolean,
) {
  return {
    ok: true as const,
    blockId: snapshot.blockId,
    masterId: snapshot.masterId,
    dateKey: snapshot.dateKey,
    isFullDay: snapshot.isFullDay,
    blockType: snapshot.blockType,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    idempotentReplay,
  };
}

function deleteBlockSuccessBody(
  snapshot: SafeMasterDeleteSnapshot,
  idempotentReplay: boolean,
) {
  return {
    ok: true as const,
    blockId: snapshot.blockId,
    masterId: snapshot.masterId,
    deleted: true as const,
    idempotentReplay,
  };
}

function extraWorkSuccessBody(
  snapshot: SafeMasterExtraWorkSnapshot,
  idempotentReplay: boolean,
) {
  return {
    ok: true as const,
    extraWorkWindowId: snapshot.extraWorkWindowId,
    masterId: snapshot.masterId,
    dateKey: snapshot.dateKey,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    isOnlineBookingEnabled: snapshot.isOnlineBookingEnabled,
    idempotentReplay,
  };
}

function extraWorkDeleteSuccessBody(
  snapshot: SafeMasterExtraWorkDeleteSnapshot,
  idempotentReplay: boolean,
) {
  return {
    ok: true as const,
    extraWorkWindowId: snapshot.extraWorkWindowId,
    masterId: snapshot.masterId,
    deleted: true as const,
    idempotentReplay,
  };
}

function bookingSuccessBody(
  snapshot: SafeMasterBookingSnapshot,
  idempotentReplay: boolean,
) {
  return {
    ok: true as const,
    bookingId: snapshot.bookingId,
    slotId: snapshot.slotId,
    masterId: snapshot.masterId,
    status: "SCHEDULED" as const,
    startsAt: snapshot.startsAt,
    idempotentReplay,
  };
}

export async function getMasterSchedule(
  request: MasterScheduleReadRequest,
): Promise<
  MasterCommandResult<{
    ok: true;
    masterId: string;
    fromDateKey: string;
    toDateKey: string;
    days: Array<{
      dateKey: string;
      appointments: ReturnType<typeof mapScheduleDayAppointmentMaster>[];
      scheduleBlocks: Array<{
        id: string;
        startsAt: string;
        endsAt: string;
        blockType: string;
        blockTypeLabel: string;
        isFullDay: boolean;
        origin: string;
      }>;
      extraWorkWindows: Array<{
        id: string;
        startsAt: string;
        endsAt: string;
        isOnlineBookingEnabled: boolean;
        origin: string;
      }>;
    }>;
  }>
> {
  try {
    await assertMasterExists(request.masterId);

    const days: Array<{
      dateKey: string;
      appointments: ReturnType<typeof mapScheduleDayAppointmentMaster>[];
      scheduleBlocks: Array<{
        id: string;
        startsAt: string;
        endsAt: string;
        blockType: string;
        blockTypeLabel: string;
        isFullDay: boolean;
        origin: string;
      }>;
      extraWorkWindows: Array<{
        id: string;
        startsAt: string;
        endsAt: string;
        isOnlineBookingEnabled: boolean;
        origin: string;
      }>;
    }> = [];

    for (
      let dateKey = request.fromDateKey;
      dateKey <= request.toDateKey;
      dateKey = addDaysToDateKey(dateKey, 1)
    ) {
      const { dayStart, dayEnd, noteDate } =
        getStudioDayRangeFromDateKey(dateKey);

      const [appointments, scheduleBlocks, extraWorkWindows] =
        await Promise.all([
          prisma.appointment.findMany({
            where: {
              masterId: request.masterId,
              startsAt: { gte: dayStart, lte: dayEnd },
              ...activeScheduleAppointmentWhere(),
            },
            include: { service: true },
            orderBy: { startsAt: "asc" },
          }),
          prisma.scheduleBlock.findMany({
            where: blocksForDayWhere(request.masterId, dateKey),
            orderBy: [{ isFullDay: "desc" }, { startsAt: "asc" }],
          }),
          prisma.extraWorkWindow.findMany({
            where: {
              masterId: request.masterId,
              workDate: noteDate,
            },
            orderBy: { startsAt: "asc" },
          }),
        ]);

      days.push({
        dateKey,
        appointments: appointments.map(mapScheduleDayAppointmentMaster),
        scheduleBlocks: scheduleBlocks.map((block) => ({
          id: block.id,
          startsAt: block.isFullDay
            ? ""
            : (block.startsAt?.toISOString() ?? ""),
          endsAt: block.isFullDay ? "" : (block.endsAt?.toISOString() ?? ""),
          blockType: block.blockType,
          blockTypeLabel: getBlockDisplayLabel(block.blockType, block.isFullDay),
          isFullDay: block.isFullDay,
          origin: block.origin,
        })),
        extraWorkWindows: extraWorkWindows.map((window) => ({
          id: window.id,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          isOnlineBookingEnabled: window.isOnlineBookingEnabled,
          origin: window.origin,
        })),
      });
    }

    return {
      ok: true,
      body: {
        ok: true,
        masterId: request.masterId,
        fromDateKey: request.fromDateKey,
        toDateKey: request.toDateKey,
        days,
      },
    };
  } catch (error) {
    const mapped = mapMasterCommandDomainFailure(error);
    if (!(error instanceof MasterCommandError)) {
      safeLogError("bot-master-schedule", error);
    }
    return failResult(mapped.code);
  }
}

export async function masterCloseInterval(
  request: MasterCloseIntervalRequest,
): Promise<MasterCommandResult<ReturnType<typeof blockSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterCloseIntervalFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-close-interval-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  await assertMasterExists(request.masterId);

  const claim = await claimMasterCloseIntervalIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
  });
  const early = await handleClaimPhase(claim, blockSuccessBody);
  if (!("claimed" in early)) return early;

  return runClaimedMutation({
    claim: early,
    fingerprint,
    logScope: "bot-master-close-interval",
    toBody: blockSuccessBody,
    execute: async (tx) => {
      const created = await createScheduleBlockWithDb(
        tx,
        {
          masterId: request.masterId,
          dateKey: request.dateKey,
          isFullDay: false,
          blockType: request.blockType,
          startTime: request.startTime,
          endTime: request.endTime,
        },
        { createdByUserId: null, origin: "BOT_MASTER_COMMAND" },
      );
      return {
        blockId: created.id,
        masterId: request.masterId,
        dateKey: request.dateKey,
        isFullDay: false,
        blockType: request.blockType,
        startsAt: created.startsAt || null,
        endsAt: created.endsAt || null,
      };
    },
  });
}

export async function masterCloseDay(
  request: MasterCloseDayRequest,
): Promise<MasterCommandResult<ReturnType<typeof blockSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterCloseDayFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-close-day-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  await assertMasterExists(request.masterId);

  const claim = await claimMasterCloseDayIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
  });
  const early = await handleClaimPhase(claim, blockSuccessBody);
  if (!("claimed" in early)) return early;

  return runClaimedMutation({
    claim: early,
    fingerprint,
    logScope: "bot-master-close-day",
    toBody: blockSuccessBody,
    execute: async (tx) => {
      const created = await createScheduleBlockWithDb(
        tx,
        {
          masterId: request.masterId,
          dateKey: request.dateKey,
          isFullDay: true,
          blockType: request.blockType,
        },
        { createdByUserId: null, origin: "BOT_MASTER_COMMAND" },
      );
      return {
        blockId: created.id,
        masterId: request.masterId,
        dateKey: request.dateKey,
        isFullDay: true,
        blockType: request.blockType,
        startsAt: null,
        endsAt: null,
      };
    },
  });
}

export async function masterDeleteBlock(
  request: MasterDeleteBlockRequest,
): Promise<MasterCommandResult<ReturnType<typeof deleteBlockSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterDeleteBlockFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-delete-block-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  await assertMasterExists(request.masterId);

  const claim = await claimMasterDeleteBlockIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
  });
  const early = await handleClaimPhase(claim, deleteBlockSuccessBody);
  if (!("claimed" in early)) return early;

  return runClaimedMutation({
    claim: early,
    fingerprint,
    logScope: "bot-master-delete-block",
    toBody: deleteBlockSuccessBody,
    execute: async (tx) => {
      const deleted = await deleteOwnedMasterScheduleBlock(tx, {
        blockId: request.blockId,
        masterId: request.masterId,
      });
      return {
        blockId: deleted.blockId,
        masterId: request.masterId,
        deleted: true as const,
      };
    },
  });
}

export async function masterCreateExtraWork(
  request: MasterExtraWorkCreateRequest,
): Promise<MasterCommandResult<ReturnType<typeof extraWorkSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterExtraWorkCreateFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-extra-work-create-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  await assertMasterExists(request.masterId);

  const claim = await claimMasterExtraWorkCreateIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
  });
  const early = await handleClaimPhase(claim, extraWorkSuccessBody);
  if (!("claimed" in early)) return early;

  return runClaimedMutation({
    claim: early,
    fingerprint,
    logScope: "bot-master-extra-work-create",
    toBody: extraWorkSuccessBody,
    execute: async (tx) => {
      const created = await createExtraWorkWindowWithDb(
        tx,
        {
          masterId: request.masterId,
          dateKey: request.dateKey,
          startTime: request.startTime,
          endTime: request.endTime,
          isOnlineBookingEnabled: request.isOnlineBookingEnabled,
        },
        { createdByUserId: null, origin: "BOT_MASTER_COMMAND" },
      );
      return {
        extraWorkWindowId: created.id,
        masterId: request.masterId,
        dateKey: request.dateKey,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        isOnlineBookingEnabled: created.isOnlineBookingEnabled,
      };
    },
  });
}

export async function masterDeleteExtraWork(
  request: MasterExtraWorkDeleteRequest,
): Promise<MasterCommandResult<ReturnType<typeof extraWorkDeleteSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterExtraWorkDeleteFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-extra-work-delete-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  await assertMasterExists(request.masterId);

  const claim = await claimMasterExtraWorkDeleteIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
  });
  const early = await handleClaimPhase(claim, extraWorkDeleteSuccessBody);
  if (!("claimed" in early)) return early;

  return runClaimedMutation({
    claim: early,
    fingerprint,
    logScope: "bot-master-extra-work-delete",
    toBody: extraWorkDeleteSuccessBody,
    execute: async (tx) => {
      const deleted = await deleteOwnedMasterExtraWorkWindow(tx, {
        extraWorkWindowId: request.extraWorkWindowId,
        masterId: request.masterId,
      });
      return {
        extraWorkWindowId: deleted.extraWorkWindowId,
        masterId: request.masterId,
        deleted: true as const,
      };
    },
  });
}

async function classifyServiceMasterAvailability(
  serviceId: string,
  masterId: string,
): Promise<void> {
  const [service, master, masterService] = await Promise.all([
    prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        isActive: true,
        isOnlineBookingEnabled: true,
        isPublic: true,
        category: { select: { isActive: true, isPublic: true } },
      },
    }),
    prisma.master.findUnique({
      where: { id: masterId },
      select: {
        id: true,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
    prisma.masterService.findUnique({
      where: { masterId_serviceId: { masterId, serviceId } },
      select: {
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    }),
  ]);

  if (
    !service ||
    !service.isActive ||
    !service.isOnlineBookingEnabled ||
    !service.isPublic ||
    !service.category?.isActive ||
    !service.category?.isPublic
  ) {
    throw new MasterCommandError("SERVICE_UNAVAILABLE", {
      finalForIdempotency: true,
    });
  }

  if (
    !master ||
    !master.isActive ||
    !master.isPublic ||
    !master.isOnlineBookingEnabled
  ) {
    throw new MasterCommandError("MASTER_UNAVAILABLE", {
      finalForIdempotency: true,
    });
  }

  if (
    !masterService ||
    !masterService.isEnabled ||
    !masterService.isPublic ||
    !masterService.isOnlineBookingEnabled
  ) {
    throw new MasterCommandError("SERVICE_MASTER_MISMATCH", {
      finalForIdempotency: true,
    });
  }
}

async function resolveMasterBookingClientId(
  tx: PrismaNs.TransactionClient,
  input: { fullName: string; phone: string },
): Promise<string> {
  const matchKey = resolveClientPhoneMatchKey(input.phone);
  if (!matchKey) {
    throw new MasterCommandError("VALIDATION_ERROR", { finalForIdempotency: true });
  }

  await getMasterCommandTestHooks().beforeClientResolve?.();

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${matchKey}))
  `;

  const normalized = normalizePhone(input.phone);
  if (!normalized) {
    throw new MasterCommandError("VALIDATION_ERROR", { finalForIdempotency: true });
  }

  const matches = await tx.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      OR: [
        { normalizedPhone: normalized },
        { normalizedPhone: { endsWith: matchKey } },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  const unique = new Map(matches.map((row) => [row.id, row]));
  if (unique.size > 1) {
    throw new MasterCommandError("CLIENT_AMBIGUOUS", { finalForIdempotency: true });
  }
  if (unique.size === 1) {
    return [...unique.keys()][0]!;
  }

  const created = await createClientFromLead(
    {
      fullName: input.fullName,
      phone: input.phone,
      source: "unknown",
      tags: ["бот-запись-мастер"],
    },
    tx,
  );
  return created.id;
}

function addMinutesToTime(
  dateKey: string,
  time: string,
  minutes: number,
): string {
  const base = parseStudioDateTime(dateKey, time);
  const result = addMinutesSafe(base, minutes);
  return formatStudioTimeInput(result ?? base);
}

export async function masterCreateBooking(
  request: MasterBookingCreateRequest,
  options: { now?: Date } = {},
): Promise<MasterCommandResult<ReturnType<typeof bookingSuccessBody>>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeMasterBookingCreateFingerprint(request);
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-master-booking-hmac", error);
      return failResult("INTERNAL_ERROR");
    }
    throw error;
  }

  const claim = await claimMasterBookingCreateIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
    now: options.now,
  });
  const early = await handleClaimPhase(claim, bookingSuccessBody);
  if (!("claimed" in early)) return early;

  const { operationId, leaseOwner, persistedFingerprint } = early;

  try {
    const slot = parseBotSlotId(request.slotId);
    if (!slot.ok) {
      throw new MasterCommandError("SLOT_INVALID", { finalForIdempotency: true });
    }
    if (slot.value.masterId !== request.masterId) {
      throw new MasterCommandError("MASTER_SCOPE_VIOLATION", {
        finalForIdempotency: true,
      });
    }

    await assertRequiredLegalDocumentsPublished();
    await classifyServiceMasterAvailability(
      slot.value.serviceId,
      slot.value.masterId,
    );

    const timing = await assertOnlineBookable(
      slot.value.masterId,
      slot.value.serviceId,
    );

    const now = options.now ?? getStudioNow();
    const studioToday = formatStudioDateKey(now);

    assertPublicMorningSlotAllowed({
      slotDateKey: slot.value.dateKey,
      startTime: slot.value.startTime,
      now,
    });

    const availableSlots = await getAvailableTimeSlots(
      slot.value.masterId,
      slot.value.serviceId,
      slot.value.dateKey,
      studioToday,
      { now },
    );

    if (!availableSlots.includes(slot.value.startTime)) {
      throw new MasterCommandError("SLOT_NO_LONGER_AVAILABLE", {
        finalForIdempotency: true,
      });
    }

    const endTime = addMinutesToTime(
      slot.value.dateKey,
      slot.value.startTime,
      timing.durationMinutes + timing.breakAfterMinutes,
    );

    const startsAt = formatStudioOffsetDateTime(
      slot.value.dateKey,
      slot.value.startTime,
    );
    if (!startsAt) {
      throw new MasterCommandError("SLOT_INVALID", { finalForIdempotency: true });
    }

    await getMasterCommandTestHooks().beforeSerializableWrite?.();

    const snapshot = await runSerializableAppointmentWrite(async (tx) => {
      await lockIdempotencyRow(
        tx,
        operationId,
        leaseOwner,
        persistedFingerprint,
      );

      const clientId = await resolveMasterBookingClientId(tx, {
        fullName: request.clientName,
        phone: request.phone,
      });

      const runtime = createAppointmentServiceRuntime({
        runSerializableWrite: async (fn) => fn(tx),
        db: tx,
      });

      const created = await createBotOnlineAppointment(
        {
          masterId: slot.value.masterId,
          dateKey: slot.value.dateKey,
          startTime: slot.value.startTime,
          endTime,
          serviceId: slot.value.serviceId,
          clientName: request.clientName,
          clientPhone: request.phone,
          clientId,
          comment: null,
        },
        "MASTER",
        runtime,
      );

      const safeSnapshot: SafeMasterBookingSnapshot = {
        bookingId: created.appointment.id,
        slotId: request.slotId,
        masterId: request.masterId,
        status: "SCHEDULED",
        startsAt,
      };

      await tx.internalBotBookingOperation.update({
        where: { id: operationId },
        data: {
          state: "SUCCEEDED",
          resultSnapshot: safeSnapshot,
          failureCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      return safeSnapshot;
    });

    return { ok: true, body: bookingSuccessBody(snapshot, false) };
  } catch (error) {
    const mapped = mapMasterCommandDomainFailure(error);
    if (!(error instanceof MasterCommandError)) {
      safeLogError("bot-master-booking-create", error);
    }
    try {
      await markMasterCommandIdempotencyFailure(prisma, {
        operationId,
        leaseOwner,
        fingerprint: persistedFingerprint,
        state: mapped.finalForIdempotency
          ? "FAILED_FINAL"
          : "FAILED_RETRYABLE",
        failureCode: mapped.code,
      });
    } catch (markError) {
      safeLogError("bot-master-booking-idempotency-mark", markError);
    }
    return failResult(mapped.code);
  }
}
