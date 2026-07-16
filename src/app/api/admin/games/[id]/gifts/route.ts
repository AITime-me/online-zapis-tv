import { NextResponse } from "next/server";
import {
  GAME_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  createGameGift,
  GameAdminNotFoundError,
  GameAdminValidationError,
} from "@/services/GameAdminService";
import type { GameGiftWriteInput } from "@/types/game-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id: gameCatalogId } = await context.params;

  try {
    const body = (await request.json()) as GameGiftWriteInput;
    const gift = await createGameGift(gameCatalogId, body);
    return NextResponse.json({ ok: true, gift });
  } catch (error) {
    if (error instanceof GameAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof GameAdminNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    throw error;
  }
}
