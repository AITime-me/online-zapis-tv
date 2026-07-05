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
import {
  AppointmentConflictError,
  AppointmentValidationError,
} from "@/services/AppointmentService";
import { createOnlineBooking } from "@/services/BookingService";
import { buildManageUrl } from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateBookingBody = {
  serviceId?: string;
  masterId?: string;
  date?: string;
  startTime?: string;
  name?: string;
  phone?: string;
  consent?: boolean;
};

function toPublicCreatedAppointment(appointment: Awaited<
  ReturnType<typeof createOnlineBooking>
>) {
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

    console.error("[booking/create] request:", {
      serviceId: body.serviceId,
      masterId: body.masterId,
      date: body.date,
      startTime: body.startTime,
      hasName: Boolean(body.name?.trim()),
      hasPhone: Boolean(body.phone?.trim()),
      consent: body.consent === true,
    });

    const clientName = typeof body.name === "string" ? body.name.trim() : "";
    const clientPhone = typeof body.phone === "string" ? body.phone.trim() : "";

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
      consent: body.consent === true,
    };

    const fieldErrors = validateClientData(clientData);

    if (hasClientDataErrors(fieldErrors)) {
      return errorResponse(getFirstClientDataError(fieldErrors), 400, {
        code: "CLIENT_VALIDATION",
        fieldErrors,
      });
    }

    if (!isValidDateKey(body.date)) {
      return errorResponse("Некорректная дата", 400, { code: "INVALID_DATE" });
    }

    const appointment = await createOnlineBooking({
      serviceId: body.serviceId,
      masterId: body.masterId,
      date: body.date,
      startTime: body.startTime,
      name: clientName,
      phone: clientPhone,
    });

    if (!appointment.manageToken) {
      return errorResponse(
        "Запись создана без manageToken. Примените миграцию manage_token и перезапустите сервер.",
        500,
        { code: "MANAGE_TOKEN_MISSING" },
      );
    }

    const manageUrl = buildManageUrl(appointment.manageToken);

    return NextResponse.json(
      {
        ok: true as const,
        appointment: toPublicCreatedAppointment(appointment),
        manageUrl,
      },
      { headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return errorResponse(error.message, 409, { code: error.name });
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
