/**
 * CURSOR-24 — confirmed bot booking create orchestration.
 * Reuses BookingService availability / online-bookable / AppointmentService write.
 */
import "server-only";

import { Prisma } from "@prisma/client";
import type { Prisma as PrismaNs } from "@prisma/client";
import {
  BotIdempotencyHmacConfigError,
  claimBotBookingIdempotency,
  computeBotBookingRequestFingerprintCandidates,
  buildSafeBotBookingResultSnapshot,
  markBotBookingIdempotencyFailure,
  toBotBookingSuccessBody,
} from "@/lib/bot-api/booking-create-idempotency";
import type {
  BotBookingCreateErrorCode,
  BotBookingCreateRequest,
  BotBookingCreateSuccessBody,
} from "@/lib/bot-api/booking-create-types";
import { parseBotSlotId } from "@/lib/booking/bot-slot-id";
import {
  assertPublicMorningSlotAllowed,
  PublicMorningSlotCutoffError,
} from "@/lib/booking/public-morning-slot-cutoff";
import {
  addMinutesSafe,
  formatStudioDateKey,
  formatStudioOffsetDateTime,
  formatStudioTimeInput,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/logging/redact";
import {
  normalizePhone,
  resolveClientPhoneMatchKey,
} from "@/lib/phone/normalize-phone";
import {
  APPOINTMENT_WRITE_SERIALIZABLE_RETRIES,
  AppointmentConflictError,
  AppointmentValidationError,
  createBotOnlineAppointment,
  createAppointmentServiceRuntime,
  isAppointmentSerializationFailure,
} from "@/services/AppointmentService";
import {
  assertOnlineBookable,
  getAvailableTimeSlots,
  OnlineServiceUnavailableError,
} from "@/services/BookingService";
import {
  getBotBookingCreateTestHooks,
  setBotBookingCreateTestHooks,
} from "@/lib/bot-api/booking-create-test-hooks";
import { createClientFromLead } from "@/services/ClientLinkService";
import { assertRequiredLegalDocumentsPublished } from "@/services/LegalDocumentService";

export {
  setBotBookingCreateTestHooks,
  clearBotBookingCreateTestHooks,
  createCountdownBarrier,
  botBookingCreateTestHooksAllowed,
} from "@/lib/bot-api/booking-create-test-hooks";

/** @deprecated Prefer setBotBookingCreateTestHooks({ afterClientResolve }) */
export function setBotBookingCreateTestAfterClientResolveHook(
  hook: (() => void) | null,
): void {
  setBotBookingCreateTestHooks(hook ? { afterClientResolve: hook } : null);
}

export class BotBookingCreateError extends Error {
  readonly code: BotBookingCreateErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly finalForIdempotency: boolean;

  constructor(
    code: BotBookingCreateErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      finalForIdempotency?: boolean;
    },
  ) {
    super(message);
    this.name = "BotBookingCreateError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? defaultHttpStatus(code);
    this.retryable = options?.retryable ?? code === "INTERNAL_ERROR";
    this.finalForIdempotency =
      options?.finalForIdempotency ??
      (code !== "INTERNAL_ERROR" &&
        code !== "IDEMPOTENCY_IN_PROGRESS" &&
        code !== "RATE_LIMITED");
  }
}

function defaultHttpStatus(code: BotBookingCreateErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "IDEMPOTENCY_CONFLICT":
    case "IDEMPOTENCY_IN_PROGRESS":
    case "SLOT_NO_LONGER_AVAILABLE":
    case "CLIENT_AMBIGUOUS":
    case "BOOKING_REQUEST_CONFLICT":
    case "BOOKING_CONFLICT":
      return 409;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

function fixedErrorMessage(code: BotBookingCreateErrorCode): string {
  switch (code) {
    case "SLOT_INVALID":
      return "Invalid slot";
    case "SLOT_NO_LONGER_AVAILABLE":
      return "Slot no longer available";
    case "SERVICE_UNAVAILABLE":
      return "Service unavailable";
    case "MASTER_UNAVAILABLE":
      return "Master unavailable";
    case "SERVICE_MASTER_MISMATCH":
      return "Service and master mismatch";
    case "CLIENT_AMBIGUOUS":
      return "Client ambiguous";
    case "BOOKING_CONFLICT":
      return "Booking conflict";
    case "IDEMPOTENCY_CONFLICT":
      return "Idempotency conflict";
    case "IDEMPOTENCY_IN_PROGRESS":
      return "Idempotency in progress";
    case "INTERNAL_ERROR":
      return "Internal error";
    default:
      return "Invalid request";
  }
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
    throw new BotBookingCreateError(
      "SERVICE_UNAVAILABLE",
      fixedErrorMessage("SERVICE_UNAVAILABLE"),
      { finalForIdempotency: true },
    );
  }

  if (
    !master ||
    !master.isActive ||
    !master.isPublic ||
    !master.isOnlineBookingEnabled
  ) {
    throw new BotBookingCreateError(
      "MASTER_UNAVAILABLE",
      fixedErrorMessage("MASTER_UNAVAILABLE"),
      { finalForIdempotency: true },
    );
  }

  if (
    !masterService ||
    !masterService.isEnabled ||
    !masterService.isPublic ||
    !masterService.isOnlineBookingEnabled
  ) {
    throw new BotBookingCreateError(
      "SERVICE_MASTER_MISMATCH",
      fixedErrorMessage("SERVICE_MASTER_MISMATCH"),
      { finalForIdempotency: true },
    );
  }
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

async function resolveBotClientId(
  tx: PrismaNs.TransactionClient,
  input: { fullName: string; phone: string; clientRef?: string },
): Promise<string> {
  if (input.clientRef) {
    return resolveBotClientIdByClientRef(tx, {
      fullName: input.fullName,
      phone: input.phone,
      clientRef: input.clientRef,
    });
  }
  return resolveBotClientIdByLegacyPhone(tx, input);
}

function failClosedBotClientRefConsistency(): never {
  throw new BotBookingCreateError(
    "INTERNAL_ERROR",
    fixedErrorMessage("INTERNAL_ERROR"),
    { retryable: false, finalForIdempotency: true },
  );
}

async function resolveCanonicalClientIdForIdentityLink(
  tx: PrismaNs.TransactionClient,
  linkedClientId: string,
): Promise<string> {
  const linked = await tx.client.findUnique({
    where: { id: linkedClientId },
    select: { id: true, mergedIntoClientId: true, isArchived: true },
  });

  if (!linked) {
    failClosedBotClientRefConsistency();
  }

  if (linked.mergedIntoClientId) {
    const target = await tx.client.findUnique({
      where: { id: linked.mergedIntoClientId },
      select: { id: true, mergedIntoClientId: true, isArchived: true },
    });
    if (!target || target.isArchived || target.mergedIntoClientId) {
      failClosedBotClientRefConsistency();
    }
    return target.id;
  }

  if (linked.isArchived) {
    failClosedBotClientRefConsistency();
  }

  return linked.id;
}

async function assertCanonicalClientPhoneMatchesForBootstrap(
  tx: PrismaNs.TransactionClient,
  canonicalClientId: string,
  normalizedPhone: string,
): Promise<void> {
  const canonical = await tx.client.findUnique({
    where: { id: canonicalClientId },
    select: {
      id: true,
      normalizedPhone: true,
      mergedIntoClientId: true,
      isArchived: true,
    },
  });

  if (
    !canonical ||
    canonical.isArchived ||
    canonical.mergedIntoClientId ||
    canonical.normalizedPhone !== normalizedPhone
  ) {
    failClosedBotClientRefConsistency();
  }
}

async function resolveBotClientIdByLegacyPhone(
  tx: PrismaNs.TransactionClient,
  input: { fullName: string; phone: string },
): Promise<string> {
  const matchKey = resolveClientPhoneMatchKey(input.phone);
  if (!matchKey) {
    throw new BotBookingCreateError(
      "VALIDATION_ERROR",
      fixedErrorMessage("VALIDATION_ERROR"),
      { finalForIdempotency: true },
    );
  }

  // Test-only: sync before real advisory lock (Race E). Inert outside SECURITY_BATCH_TEST.
  await getBotBookingCreateTestHooks().beforeClientResolve?.();

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${matchKey}))
  `;

  const normalized = normalizePhone(input.phone);
  const suffix = matchKey;
  if (!normalized) {
    throw new BotBookingCreateError(
      "VALIDATION_ERROR",
      fixedErrorMessage("VALIDATION_ERROR"),
      { finalForIdempotency: true },
    );
  }

  const matches = await tx.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      OR: [
        { normalizedPhone: normalized },
        { normalizedPhone: { endsWith: suffix } },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  const unique = new Map(matches.map((row) => [row.id, row]));
  if (unique.size > 1) {
    throw new BotBookingCreateError(
      "CLIENT_AMBIGUOUS",
      fixedErrorMessage("CLIENT_AMBIGUOUS"),
      { finalForIdempotency: true },
    );
  }

  if (unique.size === 1) {
    return [...unique.keys()][0]!;
  }

  await getBotBookingCreateTestHooks().beforeZeroClientCreate?.();

  const created = await createClientFromLead(
    {
      fullName: input.fullName,
      phone: input.phone,
      source: "unknown",
      tags: ["бот-запись"],
    },
    tx,
  );

  return created.id;
}

async function resolveBotClientIdByClientRef(
  tx: PrismaNs.TransactionClient,
  input: { fullName: string; phone: string; clientRef: string },
): Promise<string> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) {
    throw new BotBookingCreateError(
      "VALIDATION_ERROR",
      fixedErrorMessage("VALIDATION_ERROR"),
      { finalForIdempotency: true },
    );
  }

  // 1) Exact clientRef mapping is authoritative.
  const mapped = await tx.botClientIdentityLink.findUnique({
    where: { clientRef: input.clientRef },
    select: { clientId: true },
  });

  if (mapped) {
    return resolveCanonicalClientIdForIdentityLink(tx, mapped.clientId);
  }

  // 3) One-time bootstrap only, inside this protected tx.
  await getBotBookingCreateTestHooks().beforeClientResolve?.();

  // Deterministic locking order prevents split identity races:
  // always lock clientRef first, then normalizedPhone.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.clientRef}))
  `;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${normalizedPhone}))
  `;

  // If another waiter already claimed this clientRef, resolve to it deterministically.
  const afterLockMapped = await tx.botClientIdentityLink.findUnique({
    where: { clientRef: input.clientRef },
    select: { clientId: true },
  });

  if (afterLockMapped) {
    const canonicalId = await resolveCanonicalClientIdForIdentityLink(
      tx,
      afterLockMapped.clientId,
    );
    await assertCanonicalClientPhoneMatchesForBootstrap(
      tx,
      canonicalId,
      normalizedPhone,
    );
    return canonicalId;
  }

  const matches = await tx.client.findMany({
    where: {
      isArchived: false,
      mergedIntoClientId: null,
      normalizedPhone,
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  if (matches.length > 1) {
    throw new BotBookingCreateError(
      "CLIENT_AMBIGUOUS",
      fixedErrorMessage("CLIENT_AMBIGUOUS"),
      { finalForIdempotency: true },
    );
  }

  if (matches.length === 1) {
    try {
      await tx.botClientIdentityLink.create({
        data: { clientRef: input.clientRef, clientId: matches[0]!.id },
      });
      return resolveCanonicalClientIdForIdentityLink(tx, matches[0]!.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await tx.botClientIdentityLink.findUnique({
          where: { clientRef: input.clientRef },
          select: { clientId: true },
        });
        if (!existing) {
          failClosedBotClientRefConsistency();
        }

        const canonicalId = await resolveCanonicalClientIdForIdentityLink(
          tx,
          existing.clientId,
        );
        await assertCanonicalClientPhoneMatchesForBootstrap(
          tx,
          canonicalId,
          normalizedPhone,
        );
        return canonicalId;
      }
      throw error;
    }
  }

  await getBotBookingCreateTestHooks().beforeZeroClientCreate?.();

  const created = await createClientFromLead(
    {
      fullName: input.fullName,
      phone: input.phone,
      source: "unknown",
      tags: ["бот-запись"],
    },
    tx,
  );

  try {
    await tx.botClientIdentityLink.create({
      data: { clientRef: input.clientRef, clientId: created.id },
    });
    return resolveCanonicalClientIdForIdentityLink(tx, created.id);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await tx.botClientIdentityLink.findUnique({
        where: { clientRef: input.clientRef },
        select: { clientId: true },
      });
      if (!existing) {
        failClosedBotClientRefConsistency();
      }

      const canonicalId = await resolveCanonicalClientIdForIdentityLink(
        tx,
        existing.clientId,
      );
      await assertCanonicalClientPhoneMatchesForBootstrap(
        tx,
        canonicalId,
        normalizedPhone,
      );
      return canonicalId;
    }
    throw error;
  }
}

export type CreateBotConfirmedBookingResult =
  | { ok: true; body: BotBookingCreateSuccessBody }
  | {
      ok: false;
      code: BotBookingCreateErrorCode;
      error: string;
      httpStatus: number;
    };

function mapDomainFailure(error: unknown): BotBookingCreateError {
  if (error instanceof BotBookingCreateError) {
    return error;
  }
  if (error instanceof PublicMorningSlotCutoffError) {
    return new BotBookingCreateError(
      "SLOT_NO_LONGER_AVAILABLE",
      fixedErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (error instanceof AppointmentConflictError) {
    return new BotBookingCreateError(
      "SLOT_NO_LONGER_AVAILABLE",
      fixedErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (error instanceof OnlineServiceUnavailableError) {
    return new BotBookingCreateError(
      "SERVICE_UNAVAILABLE",
      fixedErrorMessage("SERVICE_UNAVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (error instanceof AppointmentValidationError) {
    return new BotBookingCreateError(
      "SERVICE_UNAVAILABLE",
      fixedErrorMessage("SERVICE_UNAVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (
    error instanceof Error &&
    error.message === "BOT_BOOKING_IDEMPOTENCY_SNAPSHOT_INVALID"
  ) {
    return new BotBookingCreateError(
      "INTERNAL_ERROR",
      fixedErrorMessage("INTERNAL_ERROR"),
      { retryable: true, finalForIdempotency: false },
    );
  }

  return new BotBookingCreateError(
    "INTERNAL_ERROR",
    fixedErrorMessage("INTERNAL_ERROR"),
    { retryable: true, finalForIdempotency: false },
  );
}

/**
 * True when public availability no longer lists this start time — used after
 * SSI aborts so a concurrent winner is observed as domain conflict (Race C/D)
 * instead of INTERNAL_ERROR when retries never reach assertNoBlockingConflict.
 */
async function isBotBookingStartTaken(input: {
  masterId: string;
  serviceId: string;
  dateKey: string;
  startTime: string;
  now: Date;
}): Promise<boolean> {
  const studioToday = formatStudioDateKey(input.now);
  const availableSlots = await getAvailableTimeSlots(
    input.masterId,
    input.serviceId,
    input.dateKey,
    studioToday,
    { now: input.now },
  );
  return !availableSlots.includes(input.startTime);
}

/**
 * Serializable write with occupancy checks on SSI failure so same-slot losers
 * convert to AppointmentConflictError once a concurrent winner commits,
 * even if the abort happened during client.create (before conflict check).
 */
async function runBotBookingSerializableWrite<T>(
  fn: (tx: PrismaNs.TransactionClient) => Promise<T>,
  isStartTaken: () => Promise<boolean>,
): Promise<T> {
  for (
    let attempt = 0;
    attempt < APPOINTMENT_WRITE_SERIALIZABLE_RETRIES;
    attempt += 1
  ) {
    if (attempt > 0 && (await isStartTaken())) {
      throw new AppointmentConflictError();
    }
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isAppointmentSerializationFailure(error)) {
        throw error;
      }
      if (await isStartTaken()) {
        throw new AppointmentConflictError();
      }
      if (attempt >= APPOINTMENT_WRITE_SERIALIZABLE_RETRIES - 1) {
        throw error;
      }
    }
  }

  throw new Error("appointment serializable transaction failed");
}

export async function createBotConfirmedBooking(
  request: BotBookingCreateRequest,
  options: { now?: Date } = {},
): Promise<CreateBotConfirmedBookingResult> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeBotBookingRequestFingerprintCandidates({
      slotId: request.slotId,
      clientName: request.clientName,
      phone: request.phone,
      ...(request.clientRef !== undefined
        ? { clientRef: request.clientRef }
        : {}),
      personalDataConsent: request.personalDataConsent,
      offerAcknowledgement: request.offerAcknowledgement,
    });
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-internal-booking-create-hmac-config", error);
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        error: fixedErrorMessage("INTERNAL_ERROR"),
        httpStatus: 500,
      };
    }
    throw error;
  }

  await getBotBookingCreateTestHooks().beforeCreate?.();

  const claim = await claimBotBookingIdempotency(prisma, {
    idempotencyKey: request.idempotencyKey,
    fingerprint,
    matchFingerprints,
    now: options.now,
  });

  if (claim.kind === "conflict") {
    return {
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      error: fixedErrorMessage("IDEMPOTENCY_CONFLICT"),
      httpStatus: 409,
    };
  }

  if (claim.kind === "in_progress") {
    return {
      ok: false,
      code: "IDEMPOTENCY_IN_PROGRESS",
      error: fixedErrorMessage("IDEMPOTENCY_IN_PROGRESS"),
      httpStatus: 409,
    };
  }

  if (claim.kind === "replay_success") {
    return {
      ok: true,
      body: toBotBookingSuccessBody(claim.snapshot, true),
    };
  }

  if (claim.kind === "replay_failure") {
    const code = (
      [
        "SLOT_INVALID",
        "SLOT_NO_LONGER_AVAILABLE",
        "SERVICE_UNAVAILABLE",
        "MASTER_UNAVAILABLE",
        "SERVICE_MASTER_MISMATCH",
        "CLIENT_AMBIGUOUS",
        "BOOKING_CONFLICT",
        "VALIDATION_ERROR",
        "INTERNAL_ERROR",
      ] as BotBookingCreateErrorCode[]
    ).includes(claim.code as BotBookingCreateErrorCode)
      ? (claim.code as BotBookingCreateErrorCode)
      : "INTERNAL_ERROR";
    return {
      ok: false,
      code,
      error: fixedErrorMessage(code),
      httpStatus: defaultHttpStatus(code),
    };
  }

  const { operationId, leaseOwner, persistedFingerprint } = claim;

  await getBotBookingCreateTestHooks().afterClaim?.();

  try {
    const slot = parseBotSlotId(request.slotId);
    if (!slot.ok) {
      throw new BotBookingCreateError(
        "SLOT_INVALID",
        fixedErrorMessage("SLOT_INVALID"),
        { finalForIdempotency: true },
      );
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
      throw new BotBookingCreateError(
        "SLOT_NO_LONGER_AVAILABLE",
        fixedErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
        { finalForIdempotency: true },
      );
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
      throw new BotBookingCreateError(
        "SLOT_INVALID",
        fixedErrorMessage("SLOT_INVALID"),
        { finalForIdempotency: true },
      );
    }

    await getBotBookingCreateTestHooks().beforeSerializableWrite?.();

    const writeNow = options.now ?? getStudioNow();
    const snapshot = await runBotBookingSerializableWrite(
      async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; state: string }>>`
        SELECT id, state::text AS state
        FROM internal_bot_booking_operations
        WHERE id = ${operationId}::uuid
        FOR UPDATE
      `;

      const op = locked[0];
      if (!op || op.state !== "IN_PROGRESS") {
        throw new BotBookingCreateError(
          "IDEMPOTENCY_IN_PROGRESS",
          fixedErrorMessage("IDEMPOTENCY_IN_PROGRESS"),
          { finalForIdempotency: false, retryable: true },
        );
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
        throw new BotBookingCreateError(
          "IDEMPOTENCY_IN_PROGRESS",
          fixedErrorMessage("IDEMPOTENCY_IN_PROGRESS"),
          { finalForIdempotency: false, retryable: true },
        );
      }

      const clientId = await resolveBotClientId(tx, {
        fullName: request.clientName,
        phone: request.phone,
        clientRef: request.clientRef,
      });

      getBotBookingCreateTestHooks().afterClientResolve?.();

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
        "TEYA",
        runtime,
      );

      const safeSnapshot = buildSafeBotBookingResultSnapshot({
        bookingId: created.appointment.id,
        slotId: request.slotId,
        startsAt,
      });

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
    },
      () =>
        isBotBookingStartTaken({
          masterId: slot.value.masterId,
          serviceId: slot.value.serviceId,
          dateKey: slot.value.dateKey,
          startTime: slot.value.startTime,
          now: writeNow,
        }),
    );

    return {
      ok: true,
      body: toBotBookingSuccessBody(snapshot, false),
    };
  } catch (error) {
    let mapped = mapDomainFailure(error);
    if (!(error instanceof BotBookingCreateError)) {
      safeLogError("bot-internal-booking-create", error);
    }

    // After Serializable retry exhaustion, a concurrent winner may already own
    // the interval. Prefer durable domain conflict over INTERNAL_ERROR so
    // callers/idempotency see SLOT_NO_LONGER_AVAILABLE (CURSOR-24 Race C/D).
    if (
      mapped.code === "INTERNAL_ERROR" &&
      isAppointmentSerializationFailure(error)
    ) {
      try {
        const slotRecheck = parseBotSlotId(request.slotId);
        if (slotRecheck.ok) {
          const now = options.now ?? getStudioNow();
          const taken = await isBotBookingStartTaken({
            masterId: slotRecheck.value.masterId,
            serviceId: slotRecheck.value.serviceId,
            dateKey: slotRecheck.value.dateKey,
            startTime: slotRecheck.value.startTime,
            now,
          });
          if (taken) {
            mapped = new BotBookingCreateError(
              "SLOT_NO_LONGER_AVAILABLE",
              fixedErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
              { finalForIdempotency: true },
            );
          }
        }
      } catch (recheckError) {
        safeLogError(
          "bot-internal-booking-create-serial-recheck",
          recheckError,
        );
      }
    }

    try {
      await markBotBookingIdempotencyFailure(prisma, {
        operationId,
        leaseOwner,
        fingerprint: persistedFingerprint,
        state: mapped.finalForIdempotency
          ? "FAILED_FINAL"
          : "FAILED_RETRYABLE",
        failureCode: mapped.code,
      });
    } catch (markError) {
      safeLogError("bot-internal-booking-create-idempotency-mark", markError);
    }

    return {
      ok: false,
      code: mapped.code,
      error: fixedErrorMessage(mapped.code),
      httpStatus: mapped.httpStatus,
    };
  }
}
