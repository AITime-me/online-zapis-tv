import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  clientAdminErrorResponse,
  readClientAdminWriteBody,
} from "@/lib/api/client-admin-route";
import {
  archiveClientForAdmin,
  getClientForAdmin,
  restoreClientForAdmin,
  updateClientForAdmin,
} from "@/services/ClientAdminService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const client = await getClientForAdmin(id);
    if (!client) {
      return NextResponse.json({ ok: false, error: "Клиент не найден" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return clientAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(CLIENTS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const body = await readClientAdminWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  const { id: _bodyId, archive, restore, ...input } = body;

  try {
    if (archive === true) {
      const client = await archiveClientForAdmin(id);
      return NextResponse.json({ ok: true, client });
    }
    if (restore === true) {
      const client = await restoreClientForAdmin(id);
      return NextResponse.json({ ok: true, client });
    }

    const client = await updateClientForAdmin(id, input);
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return clientAdminErrorResponse(error);
  }
}
