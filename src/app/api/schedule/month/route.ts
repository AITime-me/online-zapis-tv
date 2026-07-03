import { NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/auth/api-access";
import { isValidMonthKey } from "@/lib/datetime/date-key";
import { getStudioCurrentMonthKey } from "@/lib/datetime/studio";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

export async function GET(request: Request) {
  const authResult = await requireInternalApiAuth();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  const monthKey = monthParam ?? getStudioCurrentMonthKey();

  if (!isValidMonthKey(monthKey)) {
    return NextResponse.json(
      { ok: false, error: "Invalid month format. Use YYYY-MM." },
      { status: 400 },
    );
  }

  const data = await getScheduleMonthData(monthKey);

  return NextResponse.json({ ok: true, ...data });
}
