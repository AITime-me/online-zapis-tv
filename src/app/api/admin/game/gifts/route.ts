import { NextResponse } from "next/server";
import { requireApiRoles, GAME_ADMIN_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  createGameGift,
  GameAdminValidationError,
} from "@/services/GameAdminService";
import type { GameGiftWriteInput } from "@/types/game-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as GameGiftWriteInput;
    const gift = await createGameGift(body);
    return NextResponse.json({ ok: true, gift });
  } catch (error) {
    if (error instanceof GameAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}

