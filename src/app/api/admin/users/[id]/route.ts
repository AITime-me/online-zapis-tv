import { NextResponse } from "next/server";
import { USERS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  UserAdminValidationError,
  deactivateUserForAdmin,
  getUserForAdmin,
  updateUserForAdmin,
} from "@/services/UserAdminService";
import type { UserAdminUpdateInput } from "@/types/user-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const user = await getUserForAdmin(id);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Пользователь не найден" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, user });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as UserAdminUpdateInput;
    const user = await updateUserForAdmin(id, body);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    if (error instanceof UserAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const user = await deactivateUserForAdmin(id);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    if (error instanceof UserAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
