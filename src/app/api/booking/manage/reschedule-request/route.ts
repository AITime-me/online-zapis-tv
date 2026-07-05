import { NextResponse } from "next/server";
import {
  BookingManageError,
  requestRescheduleByManageToken,
} from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RescheduleBody = {
  token?: string;
  message?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RescheduleBody;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const message = typeof body.message === "string" ? body.message : "";

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Ссылка на запись недействительна" },
        { status: 400 },
      );
    }

    const appointment = await requestRescheduleByManageToken(token, message);

    return NextResponse.json({
      ok: true,
      appointment,
    });
  } catch (error) {
    if (error instanceof BookingManageError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
