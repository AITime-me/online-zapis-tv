import { NextResponse } from "next/server";
import { withPublicAvailabilityErrors } from "@/lib/booking/public-availability-route";
import {
  formatStudioDateKey,
  getStudioNow,
  isValidDateKey,
} from "@/lib/datetime/date-layer";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { getAvailableTimeSlots } from "@/services/BookingService";

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
  const dateKey = searchParams.get("date");

  if (!masterId || !serviceId || !dateKey || !isValidDateKey(dateKey)) {
    return NextResponse.json(
      {
        ok: false,
        error: "masterId, serviceId and date (YYYY-MM-DD) are required",
      },
      { status: 400 },
    );
  }

  const now = getStudioNow();
  const studioToday = formatStudioDateKey(now);

  return withPublicAvailabilityErrors(
    "booking/slots",
    () =>
      getAvailableTimeSlots(
        masterId,
        serviceId,
        dateKey,
        studioToday,
        { now },
      ),
    (slots) => NextResponse.json({ ok: true, slots, studioToday }),
  );
}
