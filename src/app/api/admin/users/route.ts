import { NextResponse } from "next/server";
import { USERS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  UserAdminValidationError,
  createUserForAdmin,
  listUsersForAdmin,
} from "@/services/UserAdminService";
import type { UserAdminCreateInput } from "@/types/user-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const users = await listUsersForAdmin();
  return NextResponse.json({ ok: true, users });
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as UserAdminCreateInput;
    const user = await createUserForAdmin(body);
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    if (error instanceof UserAdminValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
