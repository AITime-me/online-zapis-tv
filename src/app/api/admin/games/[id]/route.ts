import { NextResponse } from "next/server";
import {
  GAME_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  GameCatalogNotFoundError,
  GameCatalogValidationError,
  getGameCatalogById,
  updateGameCatalog,
} from "@/services/GameCatalogService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const origin = new URL(request.url).origin;

  try {
    const game = await getGameCatalogById(id, origin);
    return NextResponse.json({ ok: true, game });
  } catch (error) {
    if (error instanceof GameCatalogNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
      );
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as Parameters<typeof updateGameCatalog>[1];
    const origin = new URL(request.url).origin;
    const game = await updateGameCatalog(id, body, origin);
    return NextResponse.json({ ok: true, game });
  } catch (error) {
    if (error instanceof GameCatalogValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof GameCatalogNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
      );
    }
    throw error;
  }
}
