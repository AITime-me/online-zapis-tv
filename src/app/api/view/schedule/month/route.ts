import { NextResponse } from "next/server";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";
import { normalizeMonthKey } from "@/lib/datetime/date-layer";
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

  const monthKey = normalizeMonthKey(searchParams.get("month"));
  const data = await getScheduleMonthData(monthKey);

  return NextResponse.json({ ok: true, ...data });
}
