import { NextResponse } from "next/server";
import {
  GAME_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  deleteGameGift,
  GameAdminNotFoundError,
  GameAdminValidationError,
  updateGameGift,
} from "@/services/GameAdminService";
import type { GameGiftWriteInput } from "@/types/game-admin";

type RouteContext = {
  params: Promise<{ id: string; giftId: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id: gameCatalogId, giftId } = await context.params;

  try {
    const body = (await request.json()) as Partial<GameGiftWriteInput>;
    const gift = await updateGameGift(gameCatalogId, giftId, body);
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

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id: gameCatalogId, giftId } = await context.params;

  try {
    await deleteGameGift(gameCatalogId, giftId);
    return NextResponse.json({ ok: true });
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
