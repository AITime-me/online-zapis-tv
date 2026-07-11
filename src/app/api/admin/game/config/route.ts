import { NextResponse } from "next/server";
import { requireApiRoles, GAME_ADMIN_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  GameAdminNotFoundError,
  GameAdminValidationError,
  updateGameConfig,
} from "@/services/GameAdminService";
import type { GameConfigWriteInput } from "@/types/game-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as GameConfigWriteInput;
    const config = await updateGameConfig(body);
    return NextResponse.json({ ok: true, config });
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

