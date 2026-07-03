import { NextResponse } from "next/server";
import { requireApiRoles, WRITE_SCHEDULE_ROLES } from "@/lib/auth/api-access";
import { getScheduleEditorOptions } from "@/services/ScheduleEditorOptionsService";

export async function GET(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const masterId = searchParams.get("masterId");

  if (!masterId) {
    return NextResponse.json(
      { ok: false, error: "masterId is required" },
      { status: 400 },
    );
  }

  const options = await getScheduleEditorOptions(masterId);
  if (!options) {
    return NextResponse.json(
      { ok: false, error: "Master not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...options });
}
