import { NextResponse } from "next/server";
import { requireApiRoles, GAME_ADMIN_ROLES } from "@/lib/auth/api-access";
import { getGameAdminPageData } from "@/services/GameAdminService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const data = await getGameAdminPageData();
  return NextResponse.json({ ok: true, ...data });
}

