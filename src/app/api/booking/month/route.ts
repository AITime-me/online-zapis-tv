import { NextResponse } from "next/server";
import { normalizeMonthKey } from "@/lib/datetime/date-layer";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const monthParam = new URL(request.url).searchParams.get("month");
  const monthKey = normalizeMonthKey(monthParam);

  const data = await getScheduleMonthData(monthKey);
  return NextResponse.json({ ok: true, ...data });
}
