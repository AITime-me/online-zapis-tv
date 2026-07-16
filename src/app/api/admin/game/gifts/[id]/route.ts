import { NextResponse } from "next/server";
import { GAME_ADMIN_ROLES, requireProtectedMutatingApi } from "@/lib/auth/api-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LEGACY_GIFT_ROUTE_ERROR =
  "Изменение подарка доступно только через /api/admin/games/[catalogId]/gifts/[giftId]";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Legacy unscoped gift mutate is disabled to prevent catalog rebinding. */
export async function PATCH(request: Request, _context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  return NextResponse.json(
    { ok: false, error: LEGACY_GIFT_ROUTE_ERROR, code: "GAME_GIFT_CATALOG_REQUIRED" },
    { status: 400 },
  );
}

export async function DELETE(request: Request, _context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  return NextResponse.json(
    { ok: false, error: LEGACY_GIFT_ROUTE_ERROR, code: "GAME_GIFT_CATALOG_REQUIRED" },
    { status: 400 },
  );
}
