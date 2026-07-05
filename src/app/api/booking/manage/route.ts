import { NextResponse } from "next/server";
import {
  getPublicManageAppointmentByToken,
} from "@/services/BookingManageService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Ссылка на запись недействительна" },
      { status: 400 },
    );
  }

  const appointment = await getPublicManageAppointmentByToken(token);

  if (!appointment) {
    return NextResponse.json(
      { ok: false, error: "Запись не найдена" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    appointment,
  });
}
