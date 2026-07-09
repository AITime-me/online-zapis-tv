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
  appendDuplicateNote,
  isDuplicateClientComment,
  resolveClientForLead,
  type ClientLeadSource,
} from "@/services/ClientLinkService";

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

export type BookingRequestClientLinkStatus =
  | "linked"
  | "new"
  | "none"
  | "duplicate";

export type BookingRequestClientSummary = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  tags: string[];
};

export type BookingRequestDto = {
  id: string;
  clientName: string;
  clientPhone: string;
  comment: string | null;
  masterId: string | null;
  masterName: string | null;
  status: BookingRequestStatus;
  source: BookingRequestSource;
  type: BookingRequestType;
  createdAt: string;
  clientId: string | null;
  clientLinkStatus: BookingRequestClientLinkStatus;
  client: BookingRequestClientSummary | null;
};

const REQUEST_TYPE_LABELS: Record<BookingRequestType, string> = {
  MANAGER_REQUEST: "Заявка через менеджера",
  CONSULTATION_REQUEST: "Консультация",
};

const REQUEST_STATUS_LABELS: Record<BookingRequestStatus, string> = {
  NEW: "Новая",
  CONTACTED: "Связались",
  CLOSED: "Закрыта",
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
    createdAt: Date;
  } | null;
};

function resolveClientLinkStatus(
  request: Pick<BookingRequestRow, "clientId" | "comment" | "createdAt" | "client">,
): BookingRequestClientLinkStatus {
  if (isDuplicateClientComment(request.comment)) {
    return "duplicate";
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

function mapBookingRequest(request: BookingRequestRow): BookingRequestDto {
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
    client: request.client
      ? {
          id: request.client.id,
          fullName: request.client.fullName,
          phone: request.client.phone,
          email: request.client.email,
          tags: request.client.tags,
        }
      : null,
  };
}

function resolveLeadSource(input: CreateBookingRequestInput): ClientLeadSource {
  if (input.gamePlayId?.trim()) {
    return "procedure_gift_game";
  }
  return "online_booking";
}

export function getBookingRequestTypeLabel(type: BookingRequestType): string {
  return REQUEST_TYPE_LABELS[type];
}

export function getBookingRequestStatusLabel(
  status: BookingRequestStatus,
): string {
  return REQUEST_STATUS_LABELS[status];
}

const CLIENT_LINK_LABELS: Record<BookingRequestClientLinkStatus, string> = {
  linked: "Клиент найден",
  new: "Новый клиент",
  none: "Без клиента",
  duplicate: "Возможный дубль",
};

export function getBookingRequestClientLinkLabel(
  status: BookingRequestClientLinkStatus,
): string {
  return CLIENT_LINK_LABELS[status];
}

export async function createBookingRequest(
  input: CreateBookingRequestInput,
): Promise<BookingRequestDto> {
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const comment = input.comment?.trim() || null;

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

  if (input.gamePlayId?.trim()) {
    try {
      await prisma.gamePlay.update({
        where: { id: input.gamePlayId.trim() },
        data: { leadId: request.id },
      });
    } catch {
      // Связка optional: заявку не блокируем.
    }
  }

  return mapBookingRequest(request);
}

export async function listBookingRequests(): Promise<BookingRequestDto[]> {
  const requests = await prisma.bookingRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: bookingRequestInclude,
  });

  return requests.map(mapBookingRequest);
}

export async function listActiveBookingRequestsForRange(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<ScheduleDayBookingRequest[]> {
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

  return requests.map((request) => ({
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
