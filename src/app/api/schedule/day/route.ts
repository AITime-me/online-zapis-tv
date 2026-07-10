import { NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/auth/api-access";
import {
  getStudioDayRangeFromDateKey,
  getStudioTodayRange,
  isValidDateKey,
} from "@/lib/datetime/studio";
import { scheduleLoadOptionsForRole } from "@/lib/schedule/schedule-load-options";
import { getScheduleDayData } from "@/services/ScheduleDayService";

export async function GET(request: Request) {
  const authResult = await requireInternalApiAuth();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const dateKey = dateParam ?? getStudioTodayRange().dateKey;

  if (!isValidDateKey(dateKey)) {
    return NextResponse.json(
      { ok: false, error: "Invalid date format. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    getStudioDayRangeFromDateKey(dateKey);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid date value." },
      { status: 400 },
    );
  }

  const data = await getScheduleDayData(
    dateKey,
    scheduleLoadOptionsForRole(authResult.user.role),
  );

  return NextResponse.json({ ok: true, ...data });
}
