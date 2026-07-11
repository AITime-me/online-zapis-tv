import { NextResponse } from "next/server";
import {
  requireApiRoles,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import { isValidDateKey } from "@/lib/datetime/date-layer";
import { getCellEditorData } from "@/services/ExtraWorkWindowService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const masterId = searchParams.get("masterId");
  const dateKey = searchParams.get("date");

  if (!masterId || !dateKey || !isValidDateKey(dateKey)) {
    return NextResponse.json(
      { ok: false, error: "masterId and date (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  const data = await getCellEditorData(masterId, dateKey);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...data });
}
