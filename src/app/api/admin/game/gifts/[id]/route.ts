import { NextResponse } from "next/server";
import { requireApiRoles, GAME_ADMIN_ROLES } from "@/lib/auth/api-access";
import {
  deleteGameGift,
  GameAdminNotFoundError,
  GameAdminValidationError,
  updateGameGift,
} from "@/services/GameAdminService";
import type { GameGiftWriteInput } from "@/types/game-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as Partial<GameGiftWriteInput>;
    const gift = await updateGameGift(id, body);
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

export async function DELETE(_: Request, context: RouteContext) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    await deleteGameGift(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof GameAdminNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    throw error;
  }
}

