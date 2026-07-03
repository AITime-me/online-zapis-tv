import { NextResponse } from "next/server";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";
import { isValidMonthKey } from "@/lib/datetime/date-key";
import { getStudioCurrentMonthKey } from "@/lib/datetime/studio";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!isValidScheduleViewToken(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

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
