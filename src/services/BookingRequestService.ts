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

function mapBookingRequest(
  request: Awaited<ReturnType<typeof prisma.bookingRequest.findMany>>[number] & {
    master: { publicName: string } | null;
  },
): BookingRequestDto {
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
  };
}

export function getBookingRequestTypeLabel(type: BookingRequestType): string {
  return REQUEST_TYPE_LABELS[type];
}

export function getBookingRequestStatusLabel(
  status: BookingRequestStatus,
): string {
  return REQUEST_STATUS_LABELS[status];
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

  const request = await prisma.bookingRequest.create({
    data: {
      clientName,
      clientPhone,
      comment,
      masterId: input.masterId ?? null,
      type: input.type,
      source: "ONLINE",
      status: "NEW",
    },
    include: {
      master: { select: { publicName: true } },
    },
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
    include: {
      master: { select: { publicName: true } },
    },
  });

  return requests.map(mapBookingRequest);
}

export async function updateBookingRequestStatus(
  id: string,
  status: BookingRequestStatus,
): Promise<BookingRequestDto> {
  const request = await prisma.bookingRequest.update({
    where: { id },
    data: { status },
    include: {
      master: { select: { publicName: true } },
    },
  });

  return mapBookingRequest(request);
}
