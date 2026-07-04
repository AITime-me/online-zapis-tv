import { NextResponse } from "next/server";
import { isValidDateKey } from "@/lib/datetime/date-key";
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
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBookingBody;

    if (
      !body.serviceId ||
      !body.masterId ||
      !body.date ||
      !body.startTime ||
      !body.name ||
      !body.phone
    ) {
      return NextResponse.json(
        { ok: false, error: "Заполните все поля" },
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
      name: body.name,
      phone: body.phone,
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
