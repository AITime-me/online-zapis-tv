import { NextResponse } from "next/server";
import { GAME_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  GameAdminNotFoundError,
  GameAdminValidationError,
  getWheelAdminPageData,
} from "@/services/GameAdminService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(GAME_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    const data = await getWheelAdminPageData(id);
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
