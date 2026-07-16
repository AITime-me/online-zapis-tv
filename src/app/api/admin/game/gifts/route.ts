import { NextResponse } from "next/server";
import { GAME_ADMIN_ROLES, requireProtectedMutatingApi } from "@/lib/auth/api-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LEGACY_GIFT_ROUTE_ERROR =
  "Создание подарка доступно только через /api/admin/games/[catalogId]/gifts";

/** Legacy unscoped gift create is disabled to prevent orphan gifts. */
export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  return NextResponse.json(
    { ok: false, error: LEGACY_GIFT_ROUTE_ERROR, code: "GAME_GIFT_CATALOG_REQUIRED" },
    { status: 400 },
  );
}
