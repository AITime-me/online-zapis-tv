/**
 * Internal bot BookingRequest contour: feed / get / availability /
 * appointments-lookup / book_from_request.
 */
import "server-only";

import type { BookingRequestStatus, BookingRequestType } from "@prisma/client";
import {
  getRequestOnlyAvailableDaysInMonth,
  getRequestOnlyAvailableTimeSlots,
  isRequestOnlySlotAvailable,
  projectRequestOnlySlots,
} from "@/lib/bot-api/booking-request-availability";
import { BotIdempotencyHmacConfigError } from "@/lib/bot-api/booking-create-idempotency-hmac";
import {
  BOOKING_REQUEST_BOOK_OPERATION_KIND,
  buildSafeBookingRequestBookResultSnapshot,
  claimBookingRequestBookIdempotency,
  computeBookingRequestBookFingerprintCandidates,
  markBookingRequestBookIdempotencyFailure,
  toBookingRequestBookSuccessBody,
  type SafeBookingRequestBookResultSnapshot,
} from "@/lib/bot-api/booking-request-idempotency";
import {
  clearBotBookingRequestTestHooks,
  createCountdownBarrier,
  getBotBookingRequestTestHooks,
  setBotBookingRequestTestHooks,
} from "@/lib/bot-api/booking-request-test-hooks";
import type {
  BotAppointmentCandidateDto,
  BotBookingRequestAppointmentsLookupRequest,
  BotBookingRequestAppointmentsLookupSuccess,
  BotBookingRequestAvailabilityRequest,
  BotBookingRequestAvailabilitySuccess,
  BotBookingRequestBookRequest,
  BotBookingRequestBookSuccess,
  BotBookingRequestDto,
  BotBookingRequestErrorCode,
  BotBookingRequestFeedRequest,
  BotBookingRequestFeedSuccess,
  BotBookingRequestGetSuccess,
  BotGameContextDto,
} from "@/lib/bot-api/booking-request-types";
import {
  defaultBotBookingRequestHttpStatus,
  fixedBotBookingRequestErrorMessage,
} from "@/lib/bot-api/booking-request-types";
import {
  addMinutesSafe,
  formatStudioDateKey,
  formatStudioTimeInput,
  getStudioNow,
  parseStudioDateTime,
} from "@/lib/datetime/date-layer";
import { prisma } from "@/lib/db";
import { parseGiftSnapshot } from "@/lib/game/session/game-session-snapshot";
import { isGameGiftActivationMode } from "@/lib/game/gift-activation";
import { safeLogError } from "@/lib/logging/redact";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import { buildGameBookingRequestDisplay } from "@/lib/schedule/game-booking-request-display";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointmentServiceRuntime,
  createBotRequestAppointment,
  runSerializableAppointmentWrite,
} from "@/services/AppointmentService";
import { lookupClientIdForBotIdentity } from "@/services/BotIdentityLookupService";
import { mapStoredSiteAttribution } from "@/services/SiteAttributionService";

const FEED_TYPES: BookingRequestType[] = [
  "MANAGER_REQUEST",
  "CONSULTATION_REQUEST",
];

export class BotBookingRequestError extends Error {
  readonly code: BotBookingRequestErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly finalForIdempotency: boolean;

  constructor(
    code: BotBookingRequestErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      finalForIdempotency?: boolean;
    },
  ) {
    super(message);
    this.name = "BotBookingRequestError";
    this.code = code;
    this.httpStatus =
      options?.httpStatus ?? defaultBotBookingRequestHttpStatus(code);
    this.retryable = options?.retryable ?? code === "INTERNAL_ERROR";
    this.finalForIdempotency =
      options?.finalForIdempotency ??
      (code !== "INTERNAL_ERROR" &&
        code !== "IDEMPOTENCY_IN_PROGRESS" &&
        code !== "RATE_LIMITED" &&
        code !== "RECONCILIATION_REQUIRED");
  }
}

type ServiceResult<T> =
  | { ok: true; body: T }
  | {
      ok: false;
      code: BotBookingRequestErrorCode;
      error: string;
      httpStatus: number;
    };

function fail(
  code: BotBookingRequestErrorCode,
  options?: { httpStatus?: number },
): ServiceResult<never> {
  return {
    ok: false,
    code,
    error: fixedBotBookingRequestErrorMessage(code),
    httpStatus:
      options?.httpStatus ?? defaultBotBookingRequestHttpStatus(code),
  };
}

function extractPrizeType(giftSnapshot: unknown): string | null {
  if (!giftSnapshot || typeof giftSnapshot !== "object" || Array.isArray(giftSnapshot)) {
    return null;
  }
  const prizeType = (giftSnapshot as { prizeType?: unknown }).prizeType;
  return typeof prizeType === "string" && prizeType.trim()
    ? prizeType.trim()
    : null;
}

function buildGameContext(input: {
  serviceNameSnapshot: string | null;
  comment: string | null;
  play: Parameters<typeof buildGameBookingRequestDisplay>[0]["play"];
}): BotGameContextDto | null {
  if (!input.play) {
    return null;
  }

  const display = buildGameBookingRequestDisplay({
    serviceNameSnapshot: input.serviceNameSnapshot,
    comment: input.comment,
    play: input.play,
  });
  if (!display) {
    return null;
  }

  const gift = parseGiftSnapshot(input.play.giftSnapshot);
  const activationMode =
    gift?.activationMode && isGameGiftActivationMode(gift.activationMode)
      ? gift.activationMode
      : null;
  const minCourseSessions = gift?.minCourseSessions ?? null;

  return {
    gameTitle: display.catalogTitle,
    giftName: display.giftName,
    procedure: display.procedure,
    zone: display.zone,
    activationMode,
    minCourseSessions,
    prizeType: extractPrizeType(input.play.giftSnapshot),
    eligibility: {
      activationMode,
      minCourseSessions,
      managerConfirmationRequired: true,
    },
  };
}

const bookingRequestSelect = {
  id: true,
  type: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  clientName: true,
  clientPhone: true,
  masterId: true,
  serviceId: true,
  serviceNameSnapshot: true,
  clientId: true,
  appointmentId: true,
  gameCatalogId: true,
  comment: true,
} as const;

const bookingRequestContextSelect = {
  ...bookingRequestSelect,
  siteAttribution: {
    select: {
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      utmTerm: true,
      referrer: true,
      sourceMarker: true,
    },
  },
} as const;

type BookingRequestRow = {
  id: string;
  type: BookingRequestType;
  status: BookingRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  clientPhone: string;
  masterId: string | null;
  serviceId: string | null;
  serviceNameSnapshot: string | null;
  clientId: string | null;
  appointmentId: string | null;
  gameCatalogId: string | null;
  comment: string | null;
};

const gamePlaySelect = {
  leadId: true,
  id: true,
  gameDirection: true,
  gameCatalogId: true,
  gameSessionId: true,
  selectedGiftId: true,
  consumedAt: true,
  giftSnapshot: true,
  rulesSnapshot: true,
  selectedGift: {
    select: { name: true, shortDescription: true },
  },
  gameCatalog: {
    select: { id: true, slug: true, title: true },
  },
  gameSession: {
    select: {
      id: true,
      gameCatalogId: true,
      tokenHash: true,
      status: true,
      claimExpiresAt: true,
      consumedAt: true,
    },
  },
} as const;

type GamePlayLoaded = Awaited<
  ReturnType<typeof prisma.gamePlay.findMany<{ select: typeof gamePlaySelect }>>
>[number];

async function loadGamePlaysByLeadIds(
  leadIds: string[],
): Promise<Map<string, GamePlayLoaded & { leadId: string }>> {
  if (leadIds.length === 0) {
    return new Map();
  }

  const gamePlays = await prisma.gamePlay.findMany({
    where: { leadId: { in: leadIds } },
    select: gamePlaySelect,
  });

  const map = new Map<string, GamePlayLoaded & { leadId: string }>();
  for (const play of gamePlays) {
    if (!play.leadId) {
      continue;
    }
    map.set(play.leadId, { ...play, leadId: play.leadId });
  }
  return map;
}

function toBotDto(
  row: BookingRequestRow,
  play: (GamePlayLoaded & { leadId: string }) | null,
): BotBookingRequestDto | null {
  if (
    row.type !== "MANAGER_REQUEST" &&
    row.type !== "CONSULTATION_REQUEST"
  ) {
    return null;
  }

  const gameContext = play
    ? buildGameContext({
        serviceNameSnapshot: row.serviceNameSnapshot,
        comment: row.comment,
        play: {
          ...play,
          leadId: play.leadId,
          gameSession: play.gameSession
            ? {
                ...play.gameSession,
                status: play.gameSession.status as
                  | "ACTIVE"
                  | "COMPLETED"
                  | "CONSUMED"
                  | "EXPIRED",
              }
            : null,
        },
      })
    : null;

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    masterId: row.masterId,
    serviceId: row.serviceId,
    serviceNameSnapshot: row.serviceNameSnapshot,
    clientId: row.clientId,
    appointmentId: row.appointmentId,
    gameCatalogId: row.gameCatalogId,
    gameContext,
  };
}

export async function feedBotBookingRequests(
  input: BotBookingRequestFeedRequest,
): Promise<ServiceResult<BotBookingRequestFeedSuccess>> {
  try {
    const cursorCreatedAt = input.cursor
      ? new Date(input.cursor.createdAt)
      : null;
    if (input.cursor && !Number.isFinite(cursorCreatedAt?.getTime())) {
      return fail("VALIDATION_ERROR");
    }

    const rows = await prisma.bookingRequest.findMany({
      where: {
        status: "NEW",
        type: { in: FEED_TYPES },
        ...(input.cursor && cursorCreatedAt
          ? {
              OR: [
                { createdAt: { gt: cursorCreatedAt } },
                {
                  AND: [
                    { createdAt: cursorCreatedAt },
                    { id: { gt: input.cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: bookingRequestSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });

    const page = rows.slice(0, input.limit);
    const plays = await loadGamePlaysByLeadIds(page.map((row) => row.id));
    const items: BotBookingRequestDto[] = [];
    for (const row of page) {
      const dto = toBotDto(row, plays.get(row.id) ?? null);
      if (dto) {
        items.push(dto);
      }
    }

    const hasMore = rows.length > input.limit;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : null;

    return {
      ok: true,
      body: { ok: true, items, nextCursor },
    };
  } catch (error) {
    safeLogError("bot-booking-request-feed", error);
    return fail("INTERNAL_ERROR");
  }
}

export async function getBotBookingRequest(
  id: string,
): Promise<ServiceResult<BotBookingRequestGetSuccess>> {
  try {
    const row = await prisma.bookingRequest.findUnique({
      where: { id },
      select: bookingRequestContextSelect,
    });
    if (!row) {
      return fail("NOT_FOUND");
    }
    if (
      row.type !== "MANAGER_REQUEST" &&
      row.type !== "CONSULTATION_REQUEST"
    ) {
      return fail("NOT_FOUND");
    }

    const plays = await loadGamePlaysByLeadIds([row.id]);
    const item = toBotDto(row, plays.get(row.id) ?? null);
    if (!item) {
      return fail("NOT_FOUND");
    }

    return {
      ok: true,
      body: {
        ok: true,
        item: {
          ...item,
          attribution: mapStoredSiteAttribution(row.siteAttribution),
        },
      },
    };
  } catch (error) {
    safeLogError("bot-booking-request-get", error);
    return fail("INTERNAL_ERROR");
  }
}

function resolveRequestServiceMaster(row: {
  masterId: string | null;
  serviceId: string | null;
  status: BookingRequestStatus;
}): ServiceResult<{ masterId: string; serviceId: string }> {
  if (row.status !== "NEW" && row.status !== "CONTACTED") {
    return fail("BOOKING_REQUEST_INVALID");
  }
  if (!row.masterId) {
    return fail("BOOKING_REQUEST_INVALID");
  }
  if (!row.serviceId) {
    return fail("CONSULTATION_SERVICE_REQUIRED");
  }
  return { ok: true, body: { masterId: row.masterId, serviceId: row.serviceId } };
}

export async function getBotBookingRequestAvailability(
  input: BotBookingRequestAvailabilityRequest,
  options: { now?: Date } = {},
): Promise<ServiceResult<BotBookingRequestAvailabilitySuccess>> {
  try {
    const row = await prisma.bookingRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        status: true,
        masterId: true,
        serviceId: true,
        type: true,
      },
    });
    if (!row) {
      return fail("NOT_FOUND");
    }
    if (
      row.type !== "MANAGER_REQUEST" &&
      row.type !== "CONSULTATION_REQUEST"
    ) {
      return fail("NOT_FOUND");
    }

    const resolved = resolveRequestServiceMaster(row);
    if (!resolved.ok) {
      return resolved;
    }

    const now = options.now ?? getStudioNow();
    const studioToday = formatStudioDateKey(now);

    if ("date" in input) {
      const slotsResult = await getRequestOnlyAvailableTimeSlots({
        masterId: resolved.body.masterId,
        serviceId: resolved.body.serviceId,
        dateKey: input.date,
        studioToday,
        now,
      });
      if (!slotsResult.ok) {
        return fail(slotsResult.code);
      }
      const projected = await projectRequestOnlySlots({
        masterId: resolved.body.masterId,
        serviceId: resolved.body.serviceId,
        dateKey: input.date,
        times: slotsResult.times,
      });
      if (!projected.ok) {
        return fail("INTERNAL_ERROR");
      }
      return {
        ok: true,
        body: {
          ok: true,
          requestId: input.requestId,
          date: input.date,
          studioToday,
          slots: projected.slots,
        },
      };
    }

    const days = await getRequestOnlyAvailableDaysInMonth({
      masterId: resolved.body.masterId,
      serviceId: resolved.body.serviceId,
      monthKey: input.month,
      studioToday,
      now,
    });
    if (!days.ok) {
      return fail(days.code);
    }
    return {
      ok: true,
      body: {
        ok: true,
        requestId: input.requestId,
        month: input.month,
        studioToday,
        dateKeys: days.dateKeys,
      },
    };
  } catch (error) {
    safeLogError("bot-booking-request-availability", error);
    return fail("INTERNAL_ERROR");
  }
}

async function listUpcomingAppointmentsForClient(
  clientId: string,
  now: Date,
): Promise<BotAppointmentCandidateDto[]> {
  const rows = await prisma.appointment.findMany({
    where: {
      clientId,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      startsAt: { gte: now },
    },
    select: {
      id: true,
      clientId: true,
      masterId: true,
      serviceId: true,
      startsAt: true,
      createdAt: true,
      status: true,
      source: true,
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });

  return rows
    .filter((row): row is typeof row & { clientId: string } =>
      Boolean(row.clientId),
    )
    .map((row) => ({
      id: row.id,
      clientId: row.clientId,
      masterId: row.masterId,
      serviceId: row.serviceId,
      startsAt: row.startsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      status: row.status as "SCHEDULED" | "CONFIRMED",
      source: row.source,
    }));
}

export async function lookupBotBookingRequestAppointments(
  input: BotBookingRequestAppointmentsLookupRequest,
  options: { now?: Date } = {},
): Promise<ServiceResult<BotBookingRequestAppointmentsLookupSuccess>> {
  try {
    const now = options.now ?? getStudioNow();

    if ("clientId" in input) {
      const client = await prisma.client.findFirst({
        where: {
          id: input.clientId,
          isArchived: false,
          mergedIntoClientId: null,
        },
        select: { id: true },
      });
      if (!client) {
        return {
          ok: true,
          body: {
            ok: true,
            clientOutcome: "NONE",
            clientId: null,
            appointments: [],
          },
        };
      }
      const appointments = await listUpcomingAppointmentsForClient(
        client.id,
        now,
      );
      return {
        ok: true,
        body: {
          ok: true,
          clientOutcome: "UNIQUE",
          clientId: client.id,
          appointments,
        },
      };
    }

    const normalized = normalizePhone(input.phone);
    if (!normalized) {
      return {
        ok: true,
        body: {
          ok: true,
          clientOutcome: "NONE",
          clientId: null,
          appointments: [],
        },
      };
    }

    const identity = await lookupClientIdForBotIdentity(input.phone);
    if (identity.outcome === "NONE") {
      return {
        ok: true,
        body: {
          ok: true,
          clientOutcome: "NONE",
          clientId: null,
          appointments: [],
        },
      };
    }
    if (identity.outcome === "AMBIGUOUS") {
      return {
        ok: true,
        body: {
          ok: true,
          clientOutcome: "AMBIGUOUS",
          clientId: null,
          appointments: [],
        },
      };
    }

    const appointments = await listUpcomingAppointmentsForClient(
      identity.clientId,
      now,
    );
    return {
      ok: true,
      body: {
        ok: true,
        clientOutcome: "UNIQUE",
        clientId: identity.clientId,
        appointments,
      },
    };
  } catch (error) {
    safeLogError("bot-booking-request-appointments-lookup", error);
    return fail("INTERNAL_ERROR");
  }
}

function mapBookDomainFailure(error: unknown): BotBookingRequestError {
  if (error instanceof BotBookingRequestError) {
    return error;
  }
  if (error instanceof AppointmentConflictError) {
    return new BotBookingRequestError(
      "SLOT_NO_LONGER_AVAILABLE",
      fixedBotBookingRequestErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (error instanceof AppointmentValidationError) {
    return new BotBookingRequestError(
      "SERVICE_UNAVAILABLE",
      fixedBotBookingRequestErrorMessage("SERVICE_UNAVAILABLE"),
      { finalForIdempotency: true },
    );
  }
  if (
    error instanceof Error &&
    error.message === "BOOKING_REQUEST_BOOK_IDEMPOTENCY_SNAPSHOT_INVALID"
  ) {
    return new BotBookingRequestError(
      "INTERNAL_ERROR",
      fixedBotBookingRequestErrorMessage("INTERNAL_ERROR"),
      { retryable: true, finalForIdempotency: false },
    );
  }
  return new BotBookingRequestError(
    "INTERNAL_ERROR",
    fixedBotBookingRequestErrorMessage("INTERNAL_ERROR"),
    { retryable: true, finalForIdempotency: false },
  );
}

function appointmentMatchesExpected(input: {
  appointment: {
    masterId: string;
    serviceId: string | null;
    startsAt: Date;
    status: string;
  };
  masterId: string;
  serviceId: string;
  startsAt: Date;
}): boolean {
  return (
    input.appointment.masterId === input.masterId &&
    input.appointment.serviceId === input.serviceId &&
    input.appointment.startsAt.getTime() === input.startsAt.getTime() &&
    (input.appointment.status === "SCHEDULED" ||
      input.appointment.status === "CONFIRMED")
  );
}

export async function bookBotBookingRequest(
  input: BotBookingRequestBookRequest & {
    dateKey: string;
    startTime: string;
  },
  options: { now?: Date } = {},
): Promise<ServiceResult<BotBookingRequestBookSuccess>> {
  let fingerprint: string;
  let matchFingerprints: string[];
  try {
    const computed = computeBookingRequestBookFingerprintCandidates({
      requestId: input.requestId,
      startsAt: input.startsAt,
      serviceId: input.serviceId ?? "",
    });
    fingerprint = computed.current;
    matchFingerprints = computed.candidates;
  } catch (error) {
    if (error instanceof BotIdempotencyHmacConfigError) {
      safeLogError("bot-booking-request-book-hmac-config", error);
      return fail("INTERNAL_ERROR");
    }
    throw error;
  }

  const claim = await claimBookingRequestBookIdempotency(prisma, {
    idempotencyKey: input.idempotencyKey,
    fingerprint,
    matchFingerprints,
    now: options.now,
  });

  if (claim.kind === "conflict") {
    return fail("IDEMPOTENCY_CONFLICT");
  }
  if (claim.kind === "in_progress") {
    return fail("IDEMPOTENCY_IN_PROGRESS");
  }
  if (claim.kind === "replay_success") {
    return {
      ok: true,
      body: toBookingRequestBookSuccessBody(claim.snapshot, true),
    };
  }
  if (claim.kind === "replay_failure") {
    const code = (
      [
        "BOOKING_REQUEST_INVALID",
        "BOOKING_REQUEST_CONFLICT",
        "CONSULTATION_SERVICE_REQUIRED",
        "SLOT_NO_LONGER_AVAILABLE",
        "SERVICE_UNAVAILABLE",
        "MASTER_UNAVAILABLE",
        "SERVICE_MASTER_MISMATCH",
        "RECONCILIATION_REQUIRED",
        "BOOKING_CONFLICT",
        "VALIDATION_ERROR",
        "NOT_FOUND",
        "INTERNAL_ERROR",
      ] as BotBookingRequestErrorCode[]
    ).includes(claim.code as BotBookingRequestErrorCode)
      ? (claim.code as BotBookingRequestErrorCode)
      : "INTERNAL_ERROR";
    return fail(code);
  }

  const { operationId, leaseOwner, persistedFingerprint } = claim;

  try {
    const now = options.now ?? getStudioNow();
    const studioToday = formatStudioDateKey(now);
    const expectedStartsAt = parseStudioDateTime(
      input.dateKey,
      input.startTime,
    );

    const preview = await prisma.bookingRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        status: true,
        masterId: true,
        serviceId: true,
        type: true,
        appointmentId: true,
      },
    });
    if (
      !preview ||
      (preview.type !== "MANAGER_REQUEST" &&
        preview.type !== "CONSULTATION_REQUEST")
    ) {
      throw new BotBookingRequestError(
        "NOT_FOUND",
        fixedBotBookingRequestErrorMessage("NOT_FOUND"),
        { finalForIdempotency: true },
      );
    }

    const previewServiceId = preview.serviceId ?? input.serviceId ?? null;
    const previewMasterId = preview.masterId;

    let slotDurationMinutes = 0;
    let slotBreakAfterMinutes = 0;

    if (!preview.appointmentId) {
      if (!previewServiceId) {
        throw new BotBookingRequestError(
          "CONSULTATION_SERVICE_REQUIRED",
          fixedBotBookingRequestErrorMessage("CONSULTATION_SERVICE_REQUIRED"),
          { finalForIdempotency: true },
        );
      }
      if (!previewMasterId) {
        throw new BotBookingRequestError(
          "BOOKING_REQUEST_INVALID",
          fixedBotBookingRequestErrorMessage("BOOKING_REQUEST_INVALID"),
          { finalForIdempotency: true },
        );
      }
      if (preview.status !== "NEW" && preview.status !== "CONTACTED") {
        throw new BotBookingRequestError(
          "BOOKING_REQUEST_INVALID",
          fixedBotBookingRequestErrorMessage("BOOKING_REQUEST_INVALID"),
          { finalForIdempotency: true },
        );
      }

      const slotCheck = await isRequestOnlySlotAvailable({
        masterId: previewMasterId,
        serviceId: previewServiceId,
        dateKey: input.dateKey,
        startTime: input.startTime,
        studioToday,
        now,
      });
      if (!slotCheck.ok) {
        throw new BotBookingRequestError(
          slotCheck.code,
          fixedBotBookingRequestErrorMessage(slotCheck.code),
          { finalForIdempotency: true },
        );
      }
      if (!slotCheck.available) {
        throw new BotBookingRequestError(
          "SLOT_NO_LONGER_AVAILABLE",
          fixedBotBookingRequestErrorMessage("SLOT_NO_LONGER_AVAILABLE"),
          { finalForIdempotency: true },
        );
      }
      slotDurationMinutes = slotCheck.durationMinutes;
      slotBreakAfterMinutes = slotCheck.breakAfterMinutes;
    }

    type TxOutcome =
      | { kind: "success"; snapshot: SafeBookingRequestBookResultSnapshot }
      | { kind: "reconciliation_required" };

    await getBotBookingRequestTestHooks().beforeSerializableWrite?.();

    const outcome = await runSerializableAppointmentWrite(async (tx) => {
      const lockedOp = await tx.$queryRaw<
        Array<{ id: string; state: string }>
      >`
        SELECT id, state::text AS state
        FROM internal_bot_booking_operations
        WHERE id = ${operationId}::uuid
        FOR UPDATE
      `;
      const op = lockedOp[0];
      if (!op || op.state !== "IN_PROGRESS") {
        throw new BotBookingRequestError(
          "IDEMPOTENCY_IN_PROGRESS",
          fixedBotBookingRequestErrorMessage("IDEMPOTENCY_IN_PROGRESS"),
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
        throw new BotBookingRequestError(
          "IDEMPOTENCY_IN_PROGRESS",
          fixedBotBookingRequestErrorMessage("IDEMPOTENCY_IN_PROGRESS"),
          { finalForIdempotency: false, retryable: true },
        );
      }

      const lockedRequests = await tx.$queryRaw<
        Array<{
          id: string;
          status: BookingRequestStatus;
          master_id: string | null;
          service_id: string | null;
          appointment_id: string | null;
          client_name: string;
          client_phone: string;
          client_id: string | null;
          type: BookingRequestType;
        }>
      >`
        SELECT
          id,
          status,
          master_id,
          service_id,
          appointment_id,
          client_name,
          client_phone,
          client_id,
          type
        FROM booking_requests
        WHERE id = ${input.requestId}::uuid
        FOR UPDATE
      `;

      const request = lockedRequests[0];
      if (
        !request ||
        (request.type !== "MANAGER_REQUEST" &&
          request.type !== "CONSULTATION_REQUEST")
      ) {
        throw new BotBookingRequestError(
          "NOT_FOUND",
          fixedBotBookingRequestErrorMessage("NOT_FOUND"),
          { finalForIdempotency: true },
        );
      }

      const serviceId = request.service_id ?? input.serviceId ?? null;
      const masterId = request.master_id;

      if (request.appointment_id) {
        const existing = await tx.appointment.findUnique({
          where: { id: request.appointment_id },
          select: {
            id: true,
            masterId: true,
            serviceId: true,
            startsAt: true,
            status: true,
          },
        });

        if (
          existing &&
          masterId &&
          serviceId &&
          appointmentMatchesExpected({
            appointment: existing,
            masterId,
            serviceId,
            startsAt: expectedStartsAt,
          })
        ) {
          if (request.status !== "CLOSED") {
            await tx.bookingRequest.update({
              where: { id: request.id },
              data: { status: "CLOSED", appointmentId: existing.id },
            });
          }

          const safeSnapshot = buildSafeBookingRequestBookResultSnapshot({
            appointmentId: existing.id,
            requestId: request.id,
            startsAt: input.startsAt,
            serviceId,
            masterId,
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

          return { kind: "success", snapshot: safeSnapshot } satisfies TxOutcome;
        }

        if (request.status === "CLOSED") {
          throw new BotBookingRequestError(
            "BOOKING_REQUEST_CONFLICT",
            fixedBotBookingRequestErrorMessage("BOOKING_REQUEST_CONFLICT"),
            { finalForIdempotency: true },
          );
        }

        await tx.internalBotBookingOperation.update({
          where: { id: operationId },
          data: {
            state: "FAILED_RETRYABLE",
            failureCode: "RECONCILIATION_REQUIRED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return { kind: "reconciliation_required" } satisfies TxOutcome;
      }

      if (request.status !== "NEW" && request.status !== "CONTACTED") {
        throw new BotBookingRequestError(
          "BOOKING_REQUEST_INVALID",
          fixedBotBookingRequestErrorMessage("BOOKING_REQUEST_INVALID"),
          { finalForIdempotency: true },
        );
      }

      if (!serviceId) {
        throw new BotBookingRequestError(
          "CONSULTATION_SERVICE_REQUIRED",
          fixedBotBookingRequestErrorMessage("CONSULTATION_SERVICE_REQUIRED"),
          { finalForIdempotency: true },
        );
      }
      if (!masterId) {
        throw new BotBookingRequestError(
          "BOOKING_REQUEST_INVALID",
          fixedBotBookingRequestErrorMessage("BOOKING_REQUEST_INVALID"),
          { finalForIdempotency: true },
        );
      }

      const endTime = formatStudioTimeInput(
        addMinutesSafe(
          expectedStartsAt,
          slotDurationMinutes + slotBreakAfterMinutes,
        ) ?? expectedStartsAt,
      );

      const runtime = createAppointmentServiceRuntime({
        runSerializableWrite: async (fn) => fn(tx),
        db: tx,
      });

      let createdId: string;
      try {
        const created = await createBotRequestAppointment(
          {
            masterId,
            dateKey: input.dateKey,
            startTime: input.startTime,
            endTime,
            serviceId,
            clientName: request.client_name,
            clientPhone: request.client_phone,
            clientId: request.client_id,
            comment: null,
          },
          runtime,
        );
        createdId = created.appointment.id;
      } catch (error) {
        if (error instanceof AppointmentConflictError) {
          throw new BotBookingRequestError(
            "BOOKING_CONFLICT",
            fixedBotBookingRequestErrorMessage("BOOKING_CONFLICT"),
            { finalForIdempotency: true },
          );
        }
        throw error;
      }

      await tx.bookingRequest.update({
        where: { id: request.id },
        data: { appointmentId: createdId },
      });

      const verified = await tx.appointment.findUnique({
        where: { id: createdId },
        select: {
          id: true,
          masterId: true,
          serviceId: true,
          startsAt: true,
          status: true,
        },
      });

      if (
        !verified ||
        !appointmentMatchesExpected({
          appointment: verified,
          masterId,
          serviceId,
          startsAt: expectedStartsAt,
        })
      ) {
        await tx.internalBotBookingOperation.update({
          where: { id: operationId },
          data: {
            state: "FAILED_RETRYABLE",
            failureCode: "RECONCILIATION_REQUIRED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return { kind: "reconciliation_required" } satisfies TxOutcome;
      }

      await tx.bookingRequest.update({
        where: { id: request.id },
        data: { status: "CLOSED" },
      });

      const safeSnapshot = buildSafeBookingRequestBookResultSnapshot({
        appointmentId: createdId,
        requestId: request.id,
        startsAt: input.startsAt,
        serviceId,
        masterId,
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

      return { kind: "success", snapshot: safeSnapshot } satisfies TxOutcome;
    });

    if (outcome.kind === "reconciliation_required") {
      return fail("RECONCILIATION_REQUIRED");
    }

    return {
      ok: true,
      body: toBookingRequestBookSuccessBody(outcome.snapshot, false),
    };
  } catch (error) {
    const mapped = mapBookDomainFailure(error);
    if (!(error instanceof BotBookingRequestError)) {
      safeLogError("bot-booking-request-book", error);
    }

    try {
      await markBookingRequestBookIdempotencyFailure(prisma, {
        operationId,
        leaseOwner,
        fingerprint: persistedFingerprint,
        state: mapped.finalForIdempotency
          ? "FAILED_FINAL"
          : "FAILED_RETRYABLE",
        failureCode: mapped.code,
      });
    } catch (markError) {
      safeLogError("bot-booking-request-book-idempotency-mark", markError);
    }

    return {
      ok: false,
      code: mapped.code,
      error: fixedBotBookingRequestErrorMessage(mapped.code),
      httpStatus: mapped.httpStatus,
    };
  }
}

/** Exported for static architecture checks / docs. */
export const BOT_BOOKING_REQUEST_BOOK_OPERATION_KIND =
  BOOKING_REQUEST_BOOK_OPERATION_KIND;

/** Test-only race barriers (SECURITY_BATCH_TEST); no-op in production. */
export {
  clearBotBookingRequestTestHooks,
  createCountdownBarrier,
  setBotBookingRequestTestHooks,
};
