import { NextResponse } from "next/server";
import {
  GAME_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  GameAdminNotFoundError,
  GameAdminValidationError,
  seedDefaultWheelPrizesForCatalog,
} from "@/services/GameAdminService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(GAME_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    const data = await seedDefaultWheelPrizesForCatalog(id);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof GameAdminNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof GameAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
