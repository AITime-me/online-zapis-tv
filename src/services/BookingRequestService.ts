import "server-only";

import {
  BookingRequestSource,
  BookingRequestStatus,
  BookingRequestType,
} from "@prisma/client";
import {
  isClientConsentGiven,
  validateClientData,
} from "@/lib/booking/client-validation";
import { prisma } from "@/lib/db";
import { formatDateKeyInStudio } from "@/lib/datetime/date-layer";
import type { ScheduleDayBookingRequest } from "@/lib/schedule/booking-request-schedule";
import {
  toMasterScheduleBookingRequest,
  type FullScheduleBookingRequestDto,
} from "@/lib/schedule/booking-request-schedule";
import type { ScheduleBookingRequestVisibility } from "@/lib/schedule/schedule-load-options";
import type { ClientStatus } from "@prisma/client";
import {
  buildBookingRequestActiveCountWhere,
  buildBookingRequestClosedCountWhere,
  buildBookingRequestSectionWhere,
  DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE,
  type BookingRequestListQuery,
} from "@/lib/booking-requests/list-query";
import type {
  BookingRequestClientLinkStatus,
  BookingRequestClientSummary,
  BookingRequestDto,
} from "@/lib/booking-requests/booking-request-contract";
import {
  appendDuplicateNote,
  appendManagerDecisionNote,
  buildManagerCreateSeparateNote,
  buildManagerLinkNote,
  createClientFromLead,
  enrichExistingClient,
  findExactClientsByContact,
  hasPossibleDuplicateComment,
  isFioDuplicateComment,
  parsePossibleDuplicateClientIds,
  resolveClientForLead,
  type ClientLeadSource,
} from "@/services/ClientLinkService";
import { Prisma } from "@prisma/client";
import {
  buildBookingIdempotencyPayload,
  computeIdempotencyPayloadHash,
  idempotencyPayloadHashesEqual,
} from "@/lib/booking-requests/idempotency-server";
import { isCanonicalUuid } from "@/lib/booking-requests/idempotency-contract";
import {
  buildServerGameBookingComment,
  extractGameBookingCommentForPayload,
  GAME_BOOKING_UNAVAILABLE_MESSAGE,
  loadGamePlayForBooking,
  readGameSessionTokenFromRequest,
  GAME_INVALID_REQUEST_CODE,
  resolveGamePlayIdInput,
  validateGameBookingForFirstSubmit,
  validateGameBookingForIdempotentRetry,
} from "@/lib/game/game-booking-consume";
import {
  recordRequiredPublicFormAcceptances,
  resolveAcceptanceSourceForBookingRequestType,
} from "@/services/LegalAcceptanceService";
import { assertRequiredLegalDocumentsPublished } from "@/services/LegalDocumentService";

export class BookingRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingRequestValidationError";
  }
}

export class BookingRequestPublicError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "BookingRequestPublicError";
    this.code = code;
    this.status = status;
  }
}

export type CreateBookingRequestInput = {
  clientName: string;
  clientPhone: string;
  comment?: string | null;
  masterId?: string | null;
  serviceId?: string | null;
  type: BookingRequestType;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  gamePlayId?: string | null;
  /** @deprecated Not trusted from clients; resolved server-side from serviceId when present. */
  serviceName?: string | null;
  idempotencyKey: string;
  request?: Request;
};

type ResolvedBookingRequestService = {
  serviceId: string;
  serviceNameSnapshot: string;
};

/**
 * Resolves a public booking-request service by stable id.
 * Does not trust client-provided display names.
 */
async function resolveRequestedService(input: {
  serviceId: string | null | undefined;
  masterId: string | null | undefined;
}): Promise<ResolvedBookingRequestService | null> {
  const rawServiceId =
    typeof input.serviceId === "string" ? input.serviceId.trim() : "";
  if (!rawServiceId) {
    return null;
  }

  if (!isCanonicalUuid(rawServiceId)) {
    throw new BookingRequestValidationError("Услуга недоступна");
  }

  const service = await prisma.service.findUnique({
    where: { id: rawServiceId },
    select: {
      id: true,
      publicName: true,
      isActive: true,
      isPublic: true,
    },
  });

  if (!service?.isActive || !service.isPublic) {
    throw new BookingRequestValidationError("Услуга недоступна");
  }

  const masterId =
    typeof input.masterId === "string" ? input.masterId.trim() : "";
  if (masterId) {
    if (!isCanonicalUuid(masterId)) {
      throw new BookingRequestValidationError("Мастер недоступен");
    }

    const link = await prisma.masterService.findUnique({
      where: {
        masterId_serviceId: {
          masterId,
          serviceId: service.id,
        },
      },
      select: { isEnabled: true, isPublic: true },
    });

    if (!link?.isEnabled || !link.isPublic) {
      throw new BookingRequestValidationError(
        "Выбранная услуга недоступна у этого мастера",
      );
    }
  }

  return {
    serviceId: service.id,
    serviceNameSnapshot: service.publicName,
  };
}

const bookingRequestInclude = {
  master: { select: { publicName: true } },
  client: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      tags: true,
      status: true,
      isArchived: true,
      createdAt: true,
    },
  },
  appointment: {
    select: {
      id: true,
      startsAt: true,
      service: { select: { publicName: true } },
    },
  },
} as const;

type BookingRequestRow = Awaited<
  ReturnType<typeof prisma.bookingRequest.findMany>
>[number] & {
  master: { publicName: string } | null;
  client: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    tags: string[];
    status: ClientStatus;
    isArchived: boolean;
    createdAt: Date;
  } | null;
  appointment: {
    id: string;
    startsAt: Date;
    service: { publicName: string } | null;
  } | null;
};

const possibleDuplicateClientSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  tags: true,
  status: true,
  isArchived: true,
} as const;

function resolveClientLinkStatus(
  request: Pick<BookingRequestRow, "clientId" | "comment" | "createdAt" | "client">,
): BookingRequestClientLinkStatus {
  if (!request.clientId && hasPossibleDuplicateComment(request.comment)) {
    return isFioDuplicateComment(request.comment) ? "name_duplicate" : "duplicate";
  }
  if (!request.clientId) {
    return "none";
  }
  if (request.client) {
    const diff = Math.abs(
      request.client.createdAt.getTime() - request.createdAt.getTime(),
    );
    if (diff <= 120_000) {
      return "new";
    }
  }
  return "linked";
}

function mapClientSummary(
  client: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    tags: string[];
    status: ClientStatus;
    isArchived: boolean;
  },
): BookingRequestClientSummary {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    tags: client.tags,
    status: client.status,
    isArchived: client.isArchived,
  };
}

function resolveDuplicateReason(
  comment: string | null | undefined,
): string | null {
  if (!hasPossibleDuplicateComment(comment)) {
    return null;
  }
  if (isFioDuplicateComment(comment)) {
    return "Совпадает ФИО, но телефон/email другой";
  }
  return "Найдено несколько клиентов с таким телефоном или email";
}

async function loadPossibleDuplicateClients(
  comment: string | null | undefined,
): Promise<BookingRequestClientSummary[]> {
  const ids = parsePossibleDuplicateClientIds(comment);
  if (ids.length === 0) {
    return [];
  }

  const clients = await prisma.client.findMany({
    where: { id: { in: ids } },
    select: possibleDuplicateClientSelect,
  });

  const clientMap = new Map(
    clients.map((client) => [client.id, mapClientSummary(client)]),
  );

  return ids
    .map((id) => clientMap.get(id))
    .filter((client): client is BookingRequestClientSummary => Boolean(client));
}

async function mapBookingRequest(
  request: BookingRequestRow,
): Promise<BookingRequestDto> {
  const possibleDuplicateClients =
    !request.clientId && hasPossibleDuplicateComment(request.comment)
      ? await loadPossibleDuplicateClients(request.comment)
      : [];

  const appointmentStartsAt = request.appointment?.startsAt ?? null;
  const appointmentDateKey = appointmentStartsAt
    ? formatDateKeyInStudio(appointmentStartsAt)
    : null;

  return {
    id: request.id,
    clientName: request.clientName,
    clientPhone: request.clientPhone,
    comment: request.comment,
    masterId: request.masterId,
    masterName: request.master?.publicName ?? null,
    serviceId: request.serviceId ?? null,
    serviceNameSnapshot: request.serviceNameSnapshot ?? null,
    status: request.status,
    source: request.source,
    type: request.type,
    createdAt: request.createdAt.toISOString(),
    clientId: request.clientId,
    clientLinkStatus: resolveClientLinkStatus(request),
    client: request.client ? mapClientSummary(request.client) : null,
    hasPossibleClientDuplicates: possibleDuplicateClients.length > 0,
    possibleDuplicateClients,
    duplicateReason: resolveDuplicateReason(request.comment),
    appointmentId: request.appointment?.id ?? request.appointmentId ?? null,
    appointmentServiceName: request.appointment?.service?.publicName ?? null,
    appointmentStartsAt: appointmentStartsAt?.toISOString() ?? null,
    appointmentScheduleHref: appointmentDateKey
      ? `/schedule?view=day&date=${encodeURIComponent(appointmentDateKey)}`
      : null,
  };
}

function resolveLeadSource(resolvedGamePlayId: string | null): ClientLeadSource {
  if (resolvedGamePlayId) {
    return "procedure_gift_game";
  }
  return "online_booking";
}

function resolvePublicGamePlayId(raw: string | null | undefined): string | null {
  const resolution = resolveGamePlayIdInput(raw);
  if (!resolution.ok) {
    throw new BookingRequestPublicError(
      "Некорректный запрос",
      GAME_INVALID_REQUEST_CODE,
      400,
    );
  }

  if (resolution.resolution.kind === "absent") {
    return null;
  }

  return resolution.resolution.gamePlayId;
}

function gameBookingPublicMessage(code: string): string {
  if (code === "GAME_SESSION_EXPIRED") {
    return "Срок получения подарка истёк. Пожалуйста, пройдите игру ещё раз.";
  }
  return GAME_BOOKING_UNAVAILABLE_MESSAGE;
}

function throwGameBookingError(code: string): never {
  throw new BookingRequestPublicError(gameBookingPublicMessage(code), code, 400);
}

async function findIdempotentBookingRequest(
  idempotencyKey: string,
): Promise<BookingRequestRow | null> {
  return prisma.bookingRequest.findUnique({
    where: { idempotencyKey },
    include: bookingRequestInclude,
  });
}

async function assertIdempotentGameRetryAllowed(input: {
  request: Request;
  gamePlayId: string;
  bookingRequestId: string;
}): Promise<void> {
  const play = await loadGamePlayForBooking(input.gamePlayId);
  const catalogSlug = play?.gameCatalog?.slug ?? "";
  const sessionToken = readGameSessionTokenFromRequest(input.request, catalogSlug);
  const retry = validateGameBookingForIdempotentRetry({
    play,
    sessionToken,
    bookingRequestId: input.bookingRequestId,
    gamePlayId: input.gamePlayId,
  });

  if (!retry.ok) {
    throwGameBookingError(retry.code);
  }
}

async function createGameBookingRequest(
  input: CreateBookingRequestInput,
  resolvedGamePlayId: string,
  payloadHash: string,
  now: Date,
): Promise<BookingRequestDto> {
  if (!input.request) {
    throwGameBookingError("GAME_RESULT_UNAVAILABLE");
  }

  const play = await loadGamePlayForBooking(resolvedGamePlayId);
  const catalogSlug = play?.gameCatalog?.slug ?? "";
  const sessionToken = readGameSessionTokenFromRequest(input.request, catalogSlug);
  const validation = validateGameBookingForFirstSubmit(play, sessionToken, now);
  if (!validation.ok) {
    throwGameBookingError(validation.code);
  }

  const { context } = validation;
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const userMessage = extractGameBookingCommentForPayload(input.comment);
  const managerComment = buildServerGameBookingComment({
    play: context.play,
    gift: context.gift,
    userMessage,
  });

  const clientLink = await resolveClientForLead({
    fullName: clientName,
    phone: clientPhone,
    source: "procedure_gift_game",
    serviceName: context.gift.giftName,
  });

  const requestComment = clientLink.duplicateNote
    ? appendDuplicateNote(managerComment, clientLink.duplicateNote)
    : managerComment;

  const gameSessionId = context.session.id;

  try {
    const request = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.bookingRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: bookingRequestInclude,
      });

      if (duplicate) {
        if (
          !idempotencyPayloadHashesEqual(
            duplicate.idempotencyPayloadHash,
            payloadHash,
          )
        ) {
          throw new BookingRequestPublicError(
            "Idempotency-Key уже использован с другими данными заявки",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        }
        return duplicate;
      }

      const session = await tx.gameSession.findUnique({
        where: { id: gameSessionId },
        select: {
          id: true,
          gameCatalogId: true,
          status: true,
          claimExpiresAt: true,
          consumedAt: true,
          tokenHash: true,
        },
      });

      const currentPlay = await tx.gamePlay.findUnique({
        where: { id: resolvedGamePlayId },
        select: {
          id: true,
          gameSessionId: true,
          gameCatalogId: true,
          leadId: true,
          consumedAt: true,
          selectedGiftId: true,
        },
      });

      if (
        !session ||
        session.status !== "COMPLETED" ||
        session.consumedAt !== null ||
        !session.claimExpiresAt ||
        session.claimExpiresAt.getTime() <= now.getTime() ||
        !currentPlay ||
        currentPlay.gameSessionId !== gameSessionId ||
        currentPlay.gameCatalogId !== session.gameCatalogId ||
        currentPlay.leadId !== null ||
        currentPlay.consumedAt !== null ||
        !currentPlay.selectedGiftId
      ) {
        throwGameBookingError("GAME_RESULT_UNAVAILABLE");
      }

      const created = await tx.bookingRequest.create({
        data: {
          clientName,
          clientPhone,
          comment: requestComment,
          masterId: input.masterId ?? null,
          type: input.type,
          source: "ONLINE",
          status: "NEW",
          clientId: clientLink.clientId,
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: payloadHash,
        },
        include: bookingRequestInclude,
      });

      await recordRequiredPublicFormAcceptances(tx, {
        source: resolveAcceptanceSourceForBookingRequestType(
          input.type === "MANAGER_REQUEST"
            ? "MANAGER_REQUEST"
            : "CONSULTATION_REQUEST",
          true,
        ),
        bookingRequestId: created.id,
        clientId: clientLink.clientId,
        gamePlayId: resolvedGamePlayId,
        requestReference: input.idempotencyKey,
      });

      const playUpdated = await tx.gamePlay.updateMany({
        where: {
          id: resolvedGamePlayId,
          leadId: null,
          consumedAt: null,
          gameSessionId,
          selectedGiftId: { not: null },
        },
        data: {
          leadId: created.id,
          consumedAt: now,
        },
      });

      if (playUpdated.count !== 1) {
        throwGameBookingError("GAME_RESULT_UNAVAILABLE");
      }

      const sessionUpdated = await tx.gameSession.updateMany({
        where: {
          id: gameSessionId,
          status: "COMPLETED",
          consumedAt: null,
          claimExpiresAt: { gt: now },
        },
        data: {
          status: "CONSUMED",
          consumedAt: now,
        },
      });

      if (sessionUpdated.count !== 1) {
        throwGameBookingError("GAME_RESULT_UNAVAILABLE");
      }

      return created;
    });

    return mapBookingRequest(request);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findIdempotentBookingRequest(input.idempotencyKey);
      if (existing) {
        if (
          !idempotencyPayloadHashesEqual(
            existing.idempotencyPayloadHash,
            payloadHash,
          )
        ) {
          throw new BookingRequestPublicError(
            "Idempotency-Key уже использован с другими данными заявки",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        }
        await assertIdempotentGameRetryAllowed({
          request: input.request,
          gamePlayId: resolvedGamePlayId,
          bookingRequestId: existing.id,
        });
        return mapBookingRequest(existing);
      }
    }
    throw error;
  }
}

async function createRegularBookingRequest(
  input: CreateBookingRequestInput,
  payloadHash: string,
  resolvedService: ResolvedBookingRequestService | null,
): Promise<BookingRequestDto> {
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const comment = input.comment?.trim() || null;

  const clientLink = await resolveClientForLead({
    fullName: clientName,
    phone: clientPhone,
    source: resolveLeadSource(null),
    serviceName: resolvedService?.serviceNameSnapshot ?? null,
  });

  const requestComment = clientLink.duplicateNote
    ? appendDuplicateNote(comment, clientLink.duplicateNote)
    : comment;

  try {
    const request = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.bookingRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: bookingRequestInclude,
      });

      if (duplicate) {
        if (
          !idempotencyPayloadHashesEqual(
            duplicate.idempotencyPayloadHash,
            payloadHash,
          )
        ) {
          throw new BookingRequestPublicError(
            "Idempotency-Key уже использован с другими данными заявки",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        }
        return duplicate;
      }

      const created = await tx.bookingRequest.create({
        data: {
          clientName,
          clientPhone,
          comment: requestComment,
          masterId: input.masterId ?? null,
          serviceId: resolvedService?.serviceId ?? null,
          serviceNameSnapshot: resolvedService?.serviceNameSnapshot ?? null,
          type: input.type,
          source: "ONLINE",
          status: "NEW",
          clientId: clientLink.clientId,
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: payloadHash,
        },
        include: bookingRequestInclude,
      });

      await recordRequiredPublicFormAcceptances(tx, {
        source: resolveAcceptanceSourceForBookingRequestType(
          input.type === "MANAGER_REQUEST"
            ? "MANAGER_REQUEST"
            : "CONSULTATION_REQUEST",
          false,
        ),
        bookingRequestId: created.id,
        clientId: clientLink.clientId,
        requestReference: input.idempotencyKey,
      });

      return created;
    });

    return mapBookingRequest(request);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findIdempotentBookingRequest(input.idempotencyKey);
      if (existing) {
        if (
          !idempotencyPayloadHashesEqual(
            existing.idempotencyPayloadHash,
            payloadHash,
          )
        ) {
          throw new BookingRequestPublicError(
            "Idempotency-Key уже использован с другими данными заявки",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        }
        return mapBookingRequest(existing);
      }
    }
    throw error;
  }
}

export async function createBookingRequest(
  input: CreateBookingRequestInput,
): Promise<BookingRequestDto> {
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const resolvedGamePlayId = resolvePublicGamePlayId(input.gamePlayId);
  const now = new Date();

  await assertRequiredLegalDocumentsPublished();

  const fieldErrors = validateClientData({
    clientName,
    clientPhone,
    personalDataConsent: input.personalDataConsent,
    offerAcknowledgement: input.offerAcknowledgement,
  });

  if (fieldErrors.name) {
    throw new BookingRequestValidationError(fieldErrors.name);
  }

  if (fieldErrors.phone) {
    throw new BookingRequestValidationError(fieldErrors.phone);
  }

  if (!isClientConsentGiven(input.personalDataConsent)) {
    throw new BookingRequestValidationError(
      "Необходимо согласие на обработку персональных данных",
    );
  }

  if (!isClientConsentGiven(input.offerAcknowledgement)) {
    throw new BookingRequestValidationError(
      "Необходимо подтвердить ознакомление с условиями записи и публичной офертой",
    );
  }

  if (input.type === "MANAGER_REQUEST" && !input.masterId) {
    throw new BookingRequestValidationError("Мастер не указан");
  }

  if (input.masterId) {
    const master = await prisma.master.findUnique({
      where: { id: input.masterId },
      select: { id: true, isActive: true, isPublic: true },
    });

    if (!master?.isActive || !master.isPublic) {
      throw new BookingRequestValidationError("Мастер недоступен");
    }
  }

  const resolvedService = await resolveRequestedService({
    serviceId: input.serviceId,
    masterId: input.masterId,
  });

  let gameSessionId: string | null = null;
  if (resolvedGamePlayId) {
    const play = await loadGamePlayForBooking(resolvedGamePlayId);
    gameSessionId = play?.gameSessionId ?? null;
  }

  const payloadComment = resolvedGamePlayId
    ? extractGameBookingCommentForPayload(input.comment)
    : input.comment?.trim() || null;

  const payload = buildBookingIdempotencyPayload({
    clientName,
    clientPhone,
    type: input.type,
    comment: payloadComment,
    masterId: input.masterId ?? null,
    serviceId: resolvedService?.serviceId ?? null,
    personalDataConsent: input.personalDataConsent,
    offerAcknowledgement: input.offerAcknowledgement,
    gamePlayId: resolvedGamePlayId,
    gameSessionId,
  });
  const payloadHash = computeIdempotencyPayloadHash(payload);

  const existing = await findIdempotentBookingRequest(input.idempotencyKey);
  if (existing) {
    if (
      !idempotencyPayloadHashesEqual(existing.idempotencyPayloadHash, payloadHash)
    ) {
      throw new BookingRequestPublicError(
        "Idempotency-Key уже использован с другими данными заявки",
        "IDEMPOTENCY_CONFLICT",
        409,
      );
    }

    if (resolvedGamePlayId) {
      if (!input.request) {
        throwGameBookingError("GAME_RESULT_UNAVAILABLE");
      }
      await assertIdempotentGameRetryAllowed({
        request: input.request,
        gamePlayId: resolvedGamePlayId,
        bookingRequestId: existing.id,
      });
    }

    return mapBookingRequest(existing);
  }

  if (resolvedGamePlayId) {
    return createGameBookingRequest(
      input,
      resolvedGamePlayId,
      payloadHash,
      now,
    );
  }

  return createRegularBookingRequest(input, payloadHash, resolvedService);
}

async function findExactClientMatchesForBookingRequest(
  clientPhone: string,
): Promise<string[]> {
  const matches = await findExactClientsByContact(clientPhone, null);
  return matches.map((client) => client.id);
}

export async function linkBookingRequestToClient(
  requestId: string,
  clientId: string,
): Promise<BookingRequestDto> {
  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: bookingRequestInclude,
  });

  if (!request) {
    throw new BookingRequestValidationError("Заявка не найдена");
  }

  if (request.clientId) {
    throw new BookingRequestValidationError("Заявка уже связана с клиентом");
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
  });

  if (!client) {
    throw new BookingRequestValidationError("Клиент не найден");
  }

  await enrichExistingClient(client, {
    fullName: request.clientName,
    phone: request.clientPhone,
    source: request.source === "ONLINE" ? "online_booking" : "unknown",
  });

  const updated = await prisma.bookingRequest.update({
    where: { id: requestId },
    data: {
      clientId,
      comment: appendManagerDecisionNote(
        request.comment,
        buildManagerLinkNote(client),
      ),
    },
    include: bookingRequestInclude,
  });

  return mapBookingRequest(updated);
}

export async function createSeparateClientForBookingRequest(
  requestId: string,
): Promise<BookingRequestDto> {
  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: bookingRequestInclude,
  });

  if (!request) {
    throw new BookingRequestValidationError("Заявка не найдена");
  }

  if (request.clientId) {
    throw new BookingRequestValidationError("Заявка уже связана с клиентом");
  }

  const exactMatches = await findExactClientMatchesForBookingRequest(
    request.clientPhone,
  );

  if (exactMatches.length === 1) {
    throw new BookingRequestValidationError(
      "Найден клиент с таким телефоном. Свяжите заявку с существующим клиентом.",
    );
  }

  if (exactMatches.length > 1) {
    throw new BookingRequestValidationError(
      "Найдено несколько клиентов с таким телефоном. Свяжите заявку вручную.",
    );
  }

  const created = await createClientFromLead({
    fullName: request.clientName,
    phone: request.clientPhone,
    source: request.source === "ONLINE" ? "online_booking" : "unknown",
  });

  const updated = await prisma.bookingRequest.update({
    where: { id: requestId },
    data: {
      clientId: created.id,
      comment: appendManagerDecisionNote(
        request.comment,
        buildManagerCreateSeparateNote(),
      ),
    },
    include: bookingRequestInclude,
  });

  return mapBookingRequest(updated);
}

export type BookingRequestListResult = {
  requests: BookingRequestDto[];
  total: number;
  page: number;
  pageSize: number;
  activeTotal: number;
  closedTotal: number;
};

export async function listBookingRequests(): Promise<BookingRequestDto[]> {
  const result = await listBookingRequestsPaginated({
    section: "active",
    page: 1,
    pageSize: 10_000,
    statusFilter: "ALL",
  });

  const closedResult = await listBookingRequestsPaginated({
    section: "closed",
    page: 1,
    pageSize: 10_000,
    statusFilter: "ALL",
  });

  return [...result.requests, ...closedResult.requests];
}

export async function listBookingRequestsPaginated(
  query: BookingRequestListQuery,
): Promise<BookingRequestListResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = query.pageSize ?? DEFAULT_BOOKING_REQUEST_LIST_PAGE_SIZE;
  const where = buildBookingRequestSectionWhere(query);
  const countQuery = {
    phone: query.phone,
    name: query.name,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    statusFilter: query.statusFilter,
  };

  const [rows, total, activeTotal, closedTotal] = await Promise.all([
    prisma.bookingRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: bookingRequestInclude,
    }),
    prisma.bookingRequest.count({ where }),
    prisma.bookingRequest.count({
      where: buildBookingRequestActiveCountWhere(countQuery),
    }),
    prisma.bookingRequest.count({
      where: buildBookingRequestClosedCountWhere(countQuery),
    }),
  ]);

  return {
    requests: await Promise.all(rows.map((request) => mapBookingRequest(request))),
    total,
    page,
    pageSize,
    activeTotal,
    closedTotal,
  };
}

export async function listActiveBookingRequestsForRange(
  rangeStart: Date,
  rangeEnd: Date,
  visibility: ScheduleBookingRequestVisibility = "full",
): Promise<ScheduleDayBookingRequest[]> {
  if (visibility === "none") {
    return [];
  }

  const requests = await prisma.bookingRequest.findMany({
    where: {
      createdAt: { gte: rangeStart, lte: rangeEnd },
      status: { in: ["NEW", "CONTACTED"] },
    },
    include: {
      master: { select: { publicName: true } },
      appointment: {
        select: {
          id: true,
          startsAt: true,
          service: { select: { publicName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (requests.length === 0) {
    return [];
  }

  const gamePlays = await prisma.gamePlay.findMany({
    where: {
      leadId: { in: requests.map((request) => request.id) },
    },
    select: { leadId: true },
  });
  const gameLeadIds = new Set(
    gamePlays
      .map((play) => play.leadId)
      .filter((leadId): leadId is string => Boolean(leadId)),
  );

  const fullRequests: FullScheduleBookingRequestDto[] = requests.map((request) => {
    const appointmentDateKey = request.appointment
      ? formatDateKeyInStudio(request.appointment.startsAt)
      : null;

    return {
      id: request.id,
      createdAt: request.createdAt.toISOString(),
      clientName: request.clientName,
      clientPhone: request.clientPhone,
      comment: request.comment,
      status: request.status,
      type: request.type,
      isFromGame: gameLeadIds.has(request.id),
      masterName: request.master?.publicName ?? null,
      serviceId: request.serviceId ?? null,
      serviceNameSnapshot: request.serviceNameSnapshot ?? null,
      appointmentId: request.appointment?.id ?? null,
      appointmentStartsAt: request.appointment?.startsAt.toISOString() ?? null,
      appointmentServiceName: request.appointment?.service?.publicName ?? null,
      appointmentScheduleHref: appointmentDateKey
        ? `/schedule?view=day&date=${encodeURIComponent(appointmentDateKey)}`
        : null,
    };
  });

  if (visibility === "sanitized") {
    return fullRequests.map(toMasterScheduleBookingRequest);
  }

  return fullRequests;
}

export async function updateBookingRequestStatus(
  id: string,
  status: BookingRequestStatus,
): Promise<BookingRequestDto> {
  const request = await prisma.bookingRequest.update({
    where: { id },
    data: { status },
    include: bookingRequestInclude,
  });

  return mapBookingRequest(request);
}

export type {
  BookingRequestClientLinkStatus,
  BookingRequestClientSummary,
  BookingRequestDto,
} from "@/lib/booking-requests/booking-request-contract";

export {
  getBookingRequestClientLinkLabel,
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
} from "@/lib/booking-requests/booking-request-contract";
