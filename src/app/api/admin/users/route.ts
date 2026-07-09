import { NextResponse } from "next/server";
import { USERS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  readUserAdminWriteBody,
  userAdminErrorResponse,
} from "@/lib/api/user-admin-route";
import {
  createUserForAdmin,
  deactivateUserForAdmin,
  getUserForAdmin,
  listUsersForAdmin,
  updateUserForAdmin,
} from "@/services/UserAdminService";
import type { UserAdminCreateInput } from "@/types/user-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const users = await listUsersForAdmin();
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
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
    return userAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const body = await readUserAdminWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Не указан id пользователя" },
      { status: 400 },
    );
  }

  const { id: _id, ...input } = body;

  try {
    const user = await updateUserForAdmin(id, input);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const authResult = await requireApiRoles(USERS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const body = await readUserAdminWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Не указан id пользователя" },
      { status: 400 },
    );
  }

  try {
    const user = await deactivateUserForAdmin(id);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
}
