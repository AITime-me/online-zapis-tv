import { NextResponse } from "next/server";
import {
  GAME_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  createGameCatalog,
  GameCatalogValidationError,
  listGameCatalog,
} from "@/services/GameCatalogService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const origin = new URL(request.url).origin;
  const games = await listGameCatalog(origin);
  return NextResponse.json({ ok: true, games });
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as Parameters<typeof createGameCatalog>[0];
    const origin = new URL(request.url).origin;
    const game = await createGameCatalog(body, origin);
    return NextResponse.json({ ok: true, game });
  } catch (error) {
    if (error instanceof GameCatalogValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
