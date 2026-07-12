import { NextResponse } from "next/server";
import { BookingRequestType } from "@prisma/client";
import {
  getFirstClientDataError,
  hasClientDataErrors,
  validateClientData,
  type ClientDataInput,
} from "@/lib/booking/client-validation";
import {
  IDEMPOTENCY_KEY_HEADER,
  validateIdempotencyKeyHeader,
} from "@/lib/booking-requests/idempotency-contract";
import { toPublicBookingRequestCreateResponse } from "@/lib/booking-requests/public-booking-request-contract";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { enforceValidatedPhoneRateLimit } from "@/lib/security/rate-limit/booking-phone";
import {
  BookingRequestPublicError,
  BookingRequestValidationError,
  createBookingRequest,
} from "@/services/BookingRequestService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateBookingRequestBody = {
  clientName?: string;
  clientPhone?: string;
  comment?: string;
  masterId?: string | null;
  type?: BookingRequestType;
  consent?: boolean;
  gamePlayId?: string | null;
  serviceName?: string | null;
};

export async function POST(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return originResponse;
  }

  const idempotencyValidation = validateIdempotencyKeyHeader(
    request.headers.get(IDEMPOTENCY_KEY_HEADER),
  );
  if (!idempotencyValidation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: idempotencyValidation.message,
        code: idempotencyValidation.code,
      },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as CreateBookingRequestBody;
    const clientName =
      typeof body.clientName === "string" ? body.clientName.trim() : "";
    const clientPhone =
      typeof body.clientPhone === "string" ? body.clientPhone.trim() : "";

    if (
      !body.type ||
      (body.type !== "MANAGER_REQUEST" &&
        body.type !== "CONSULTATION_REQUEST")
    ) {
      return NextResponse.json(
        { ok: false, error: "Заполните обязательные поля" },
        { status: 400 },
      );
    }

    const clientData: ClientDataInput = {
      clientName,
      clientPhone,
      consent: body.consent === true,
    };

    const fieldErrors = validateClientData(clientData);

    if (hasClientDataErrors(fieldErrors)) {
      return NextResponse.json(
        {
          ok: false,
          error: getFirstClientDataError(fieldErrors),
          fieldErrors,
        },
        { status: 400 },
      );
    }

    const phoneRateLimitResponse = enforceValidatedPhoneRateLimit(
      request,
      "bookingRequest",
      clientPhone,
    );
    if (phoneRateLimitResponse) {
      return phoneRateLimitResponse;
    }

    const bookingRequest = await createBookingRequest({
      clientName,
      clientPhone,
      comment: body.comment,
      masterId: body.masterId ?? null,
      type: body.type,
      consent: body.consent === true,
      gamePlayId:
        typeof body.gamePlayId === "string"
          ? body.gamePlayId
          : body.gamePlayId ?? null,
      idempotencyKey: idempotencyValidation.key,
      request,
    });

    return NextResponse.json(
      toPublicBookingRequestCreateResponse({ id: bookingRequest.id }),
    );
  } catch (error) {
    if (error instanceof BookingRequestPublicError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (error instanceof BookingRequestValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
