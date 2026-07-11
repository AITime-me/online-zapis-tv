import { NextResponse } from "next/server";
import { USERS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  readUserAdminWriteBody,
  userAdminErrorResponse,
} from "@/lib/api/user-admin-route";
import {
  deactivateUserForAdmin,
  getUserForAdmin,
  updateUserForAdmin,
} from "@/services/UserAdminService";

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

  try {
    const user = await getUserForAdmin(id);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Пользователь не найден" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(USERS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const body = await readUserAdminWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  const { id: _bodyId, ...input } = body;

  try {
    const user = await updateUserForAdmin(id, input);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(USERS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const user = await deactivateUserForAdmin(id);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return userAdminErrorResponse(error);
  }
}
