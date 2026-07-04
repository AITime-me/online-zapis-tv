import { NextResponse } from "next/server";
import { isValidMonthKey } from "@/lib/datetime/date-key";
import { getStudioCurrentMonthKey } from "@/lib/datetime/studio";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const monthParam = new URL(request.url).searchParams.get("month");
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
