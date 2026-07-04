import { NextResponse } from "next/server";
import { isValidMonthKey } from "@/lib/datetime/date-key";
import {
  formatDateKeyInStudio,
  getStudioCurrentMonthKey,
} from "@/lib/datetime/studio";
import { getAvailableDaysInMonth } from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const masterId = searchParams.get("masterId");
  const serviceId = searchParams.get("serviceId");
  const monthParam = searchParams.get("month");
  const monthKey =
    monthParam && isValidMonthKey(monthParam)
      ? monthParam
      : getStudioCurrentMonthKey();

  if (!masterId || !serviceId) {
    return NextResponse.json(
      { ok: false, error: "masterId and serviceId are required" },
      { status: 400 },
    );
  }

  if (!isValidMonthKey(monthKey)) {
    return NextResponse.json(
      { ok: false, error: "Invalid month format. Use YYYY-MM." },
      { status: 400 },
    );
  }

  const studioToday = formatDateKeyInStudio(new Date());
  const dateKeys = await getAvailableDaysInMonth(
    masterId,
    serviceId,
    monthKey,
    studioToday,
  );

  return NextResponse.json({ ok: true, dateKeys, month: monthKey, studioToday });
}
