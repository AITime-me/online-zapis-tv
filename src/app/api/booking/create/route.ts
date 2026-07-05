import { NextResponse } from "next/server";
import { isValidDateKey } from "@/lib/datetime/date-layer";
import {
  getFirstClientDataError,
  hasClientDataErrors,
  validateClientData,
  type ClientDataInput,
} from "@/lib/booking/client-validation";
import {
  AppointmentConflictError,
  AppointmentValidationError,
} from "@/services/AppointmentService";
import { createOnlineBooking } from "@/services/BookingService";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBookingBody;
    const clientName = typeof body.name === "string" ? body.name.trim() : "";
    const clientPhone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!body.serviceId || !body.masterId || !body.date || !body.startTime) {
      return NextResponse.json(
        { ok: false, error: "Заполните все поля" },
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

    if (!isValidDateKey(body.date)) {
      return NextResponse.json(
        { ok: false, error: "Некорректная дата" },
        { status: 400 },
      );
    }

    const appointment = await createOnlineBooking({
      serviceId: body.serviceId,
      masterId: body.masterId,
      date: body.date,
      startTime: body.startTime,
      name: clientName,
      phone: clientPhone,
    });

    return NextResponse.json({ ok: true, appointment });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AppointmentValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
