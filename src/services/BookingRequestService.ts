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
import {
  buildGamePlayConsumeWhere,
  GAME_PLAY_BOOKING_MAX_AGE_MS,
  GAME_PLAY_BOOKING_REJECTED_MESSAGE,
  shouldRejectGamePlayLink,
  validateGamePlayBookingRecord,
} from "@/lib/game/game-play-booking";
import { buildServerGameManagerComment } from "@/lib/game/game-lead-messages";
import { extractGameBookingUserMessage } from "@/lib/game/game-booking-comment";

export class BookingRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingRequestValidationError";
  }
}

export type CreateBookingRequestInput = {
  clientName: string;
  clientPhone: string;
  comment?: string | null;
  masterId?: string | null;
  type: BookingRequestType;
  consent: boolean;
  gamePlayId?: string | null;
  serviceName?: string | null;
};

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

  return {
    id: request.id,
    clientName: request.clientName,
    clientPhone: request.clientPhone,
    comment: request.comment,
    masterId: request.masterId,
    masterName: request.master?.publicName ?? null,
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
  };
}

function resolveLeadSource(input: CreateBookingRequestInput): ClientLeadSource {
  if (input.gamePlayId?.trim()) {
    return "procedure_gift_game";
  }
  return "online_booking";
}

export async function createBookingRequest(
  input: CreateBookingRequestInput,
): Promise<BookingRequestDto> {
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const comment = input.comment?.trim() || null;
  const trimmedGamePlayId = input.gamePlayId?.trim() || null;

  const fieldErrors = validateClientData({
    clientName,
    clientPhone,
    consent: input.consent,
  });

  if (fieldErrors.name) {
    throw new BookingRequestValidationError(fieldErrors.name);
  }

  if (fieldErrors.phone) {
    throw new BookingRequestValidationError(fieldErrors.phone);
  }

  if (!isClientConsentGiven(input.consent)) {
    throw new BookingRequestValidationError(
      "Необходимо согласие на обработку персональных данных",
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

  if (trimmedGamePlayId) {
    const play = await prisma.gamePlay.findUnique({
      where: { id: trimmedGamePlayId },
      select: {
        id: true,
        leadId: true,
        createdAt: true,
        gameDirection: true,
        selectedGiftId: true,
        selectedGift: { select: { name: true } },
      },
    });

    const playValidation = validateGamePlayBookingRecord(play);
    if (!playValidation.ok) {
      throw new BookingRequestValidationError(playValidation.error);
    }

    const minCreatedAt = new Date(Date.now() - GAME_PLAY_BOOKING_MAX_AGE_MS);
    const userMessage = extractGameBookingUserMessage(comment);
    const managerComment = buildServerGameManagerComment({
      gameDirection: playValidation.gameDirection,
      giftName: playValidation.giftName,
      userMessage,
    });

    const clientLink = await resolveClientForLead({
      fullName: clientName,
      phone: clientPhone,
      source: "procedure_gift_game",
      serviceName: playValidation.giftName,
    });

    const requestComment = clientLink.duplicateNote
      ? appendDuplicateNote(managerComment, clientLink.duplicateNote)
      : managerComment;

    const request = await prisma.$transaction(async (tx) => {
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
        },
        include: bookingRequestInclude,
      });

      const linked = await tx.gamePlay.updateMany({
        where: buildGamePlayConsumeWhere(trimmedGamePlayId, minCreatedAt),
        data: { leadId: created.id },
      });

      if (shouldRejectGamePlayLink(linked.count)) {
        throw new BookingRequestValidationError(GAME_PLAY_BOOKING_REJECTED_MESSAGE);
      }

      return created;
    });

    return mapBookingRequest(request);
  }

  const clientLink = await resolveClientForLead({
    fullName: clientName,
    phone: clientPhone,
    source: resolveLeadSource(input),
    serviceName: input.serviceName,
  });

  const requestComment = clientLink.duplicateNote
    ? appendDuplicateNote(comment, clientLink.duplicateNote)
    : comment;

  const request = await prisma.bookingRequest.create({
    data: {
      clientName,
      clientPhone,
      comment: requestComment,
      masterId: input.masterId ?? null,
      type: input.type,
      source: "ONLINE",
      status: "NEW",
      clientId: clientLink.clientId,
    },
    include: bookingRequestInclude,
  });

  return mapBookingRequest(request);
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

  const fullRequests: FullScheduleBookingRequestDto[] = requests.map((request) => ({
    id: request.id,
    createdAt: request.createdAt.toISOString(),
    clientName: request.clientName,
    clientPhone: request.clientPhone,
    comment: request.comment,
    status: request.status,
    type: request.type,
    isFromGame: gameLeadIds.has(request.id),
    masterName: request.master?.publicName ?? null,
  }));

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
