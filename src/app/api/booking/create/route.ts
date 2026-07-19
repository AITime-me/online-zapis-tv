import { NextResponse } from "next/server";
import { isValidDateKey } from "@/lib/datetime/date-layer";
import {
  getFirstClientDataError,
  hasClientDataErrors,
  validateClientData,
  type ClientDataInput,
} from "@/lib/booking/client-validation";
import {
  logBookingCreateErrorRaw,
  toApiErrorBody,
} from "@/lib/errors/format-service-error";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { enforceValidatedPhoneRateLimit } from "@/lib/security/rate-limit/booking-phone";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import {
  AppointmentConflictError,
  AppointmentValidationError,
} from "@/services/AppointmentService";
import {
  createOnlineBooking,
  OnlineServiceUnavailableError,
} from "@/services/BookingService";
import { buildManageUrl } from "@/lib/booking/manage-token";
import { LegalDocumentsNotReadyError } from "@/services/LegalDocumentService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateBookingBody = {
  serviceId?: string;
  masterId?: string;
  date?: string;
  startTime?: string;
  name?: string;
  phone?: string;
  comment?: string | null;
  personalDataConsent?: boolean;
  offerAcknowledgement?: boolean;
};

function toPublicCreatedAppointment(appointment: Awaited<
  ReturnType<typeof createOnlineBooking>
>["appointment"]) {
  return {
    serviceName: appointment.serviceName,
    startsAt: appointment.startsAt,
    status: appointment.status,
    source: appointment.source,
    appliedPromotions: appointment.appliedPromotions,
  };
}

function errorResponse(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      ok: false as const,
      error,
      code: typeof extra?.code === "string" ? extra.code : "BOOKING_CREATE_ERROR",
      ...extra,
    },
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

export async function POST(request: Request) {
  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return originResponse;
  }

  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let body: CreateBookingBody | null = null;

  try {
    try {
      body = (await request.json()) as CreateBookingBody;
    } catch (parseError) {
      logBookingCreateErrorRaw(parseError);
      return errorResponse("Некорректный JSON в запросе", 400, {
        code: "INVALID_JSON",
      });
    }

    const clientName = typeof body.name === "string" ? body.name.trim() : "";
    const clientPhone = typeof body.phone === "string" ? body.phone.trim() : "";
    const comment =
      typeof body.comment === "string" ? body.comment.trim() : "";

    if (!body.serviceId || !body.masterId || !body.date || !body.startTime) {
      return errorResponse("Заполните все поля", 400, {
        code: "MISSING_FIELDS",
        missing: {
          serviceId: !body.serviceId,
          masterId: !body.masterId,
          date: !body.date,
          startTime: !body.startTime,
        },
      });
    }

    const clientData: ClientDataInput = {
      clientName,
      clientPhone,
      personalDataConsent: body.personalDataConsent === true,
      offerAcknowledgement: body.offerAcknowledgement === true,
    };

    const fieldErrors = validateClientData(clientData);

    if (hasClientDataErrors(fieldErrors)) {
      return errorResponse(getFirstClientDataError(fieldErrors), 400, {
        code: "CLIENT_VALIDATION",
        fieldErrors,
      });
    }

    const phoneRateLimitResponse = enforceValidatedPhoneRateLimit(
      request,
      "bookingCreate",
      clientPhone,
    );
    if (phoneRateLimitResponse) {
      return phoneRateLimitResponse;
    }

    if (!isValidDateKey(body.date)) {
      return errorResponse("Некорректная дата", 400, { code: "INVALID_DATE" });
    }

    const created = await createOnlineBooking({
      serviceId: body.serviceId,
      masterId: body.masterId,
      date: body.date,
      startTime: body.startTime,
      name: clientName,
      phone: clientPhone,
      comment: comment || undefined,
      personalDataConsent: true,
      offerAcknowledgement: true,
    });

    if (!created.issuedManageToken) {
      return errorResponse(
        "Запись создана без manage token. Примените миграцию manage_token_hash и перезапустите сервер.",
        500,
        { code: "MANAGE_TOKEN_MISSING" },
      );
    }

    const manageUrl = buildManageUrl(created.issuedManageToken);

    return NextResponse.json(
      {
        ok: true as const,
        appointment: toPublicCreatedAppointment(created.appointment),
        manageUrl,
      },
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof LegalDocumentsNotReadyError) {
      return errorResponse(error.message, 503, {
        code: "LEGAL_DOCUMENTS_NOT_READY",
        missingSlugs: error.missingSlugs,
      });
    }
    if (error instanceof AppointmentConflictError) {
      return errorResponse(error.message, 409, { code: error.name });
    }
    if (error instanceof OnlineServiceUnavailableError) {
      return errorResponse(error.message, 400, { code: error.name });
    }
    if (error instanceof AppointmentValidationError) {
      return errorResponse(error.message, 400, { code: error.name });
    }

    logBookingCreateErrorRaw(error);
    const body = toApiErrorBody(error);

    return NextResponse.json(body, {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
