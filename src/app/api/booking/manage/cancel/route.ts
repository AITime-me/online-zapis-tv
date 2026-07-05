import { NextResponse } from "next/server";
import {
  BookingManageError,
  cancelAppointmentByManageToken,
} from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CancelBody = {
  token?: string;
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CancelBody;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Ссылка на запись недействительна" },
        { status: 400 },
      );
    }

    const result = await cancelAppointmentByManageToken(token, reason);

    return NextResponse.json({
      ok: true,
      alreadyCancelled: result.alreadyCancelled,
      appointment: result.view,
    });
  } catch (error) {
    if (error instanceof BookingManageError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
