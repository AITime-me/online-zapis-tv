import { NextResponse } from "next/server";
import { formatStudioDateKey, getStudioNow, isValidDateKey, normalizeMonthKey } from "@/lib/datetime/date-layer";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { getAvailableDaysInMonth } from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { searchParams } = new URL(request.url);
  const masterId = searchParams.get("masterId");
  const serviceId = searchParams.get("serviceId");
  const monthKey = normalizeMonthKey(searchParams.get("month"));

  if (!masterId || !serviceId) {
    return NextResponse.json(
      { ok: false, error: "masterId and serviceId are required" },
      { status: 400 },
    );
  }

  const studioToday = formatStudioDateKey(getStudioNow());
  const dateKeys = await getAvailableDaysInMonth(
    masterId,
    serviceId,
    monthKey,
    studioToday,
  );

  return NextResponse.json({ ok: true, dateKeys, month: monthKey, studioToday });
}
