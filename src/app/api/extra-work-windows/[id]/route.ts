import { NextResponse } from "next/server";
import { requireApiRoles, WRITE_SCHEDULE_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import { deleteExtraWorkWindow } from "@/services/ExtraWorkWindowService";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(WRITE_SCHEDULE_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  await deleteExtraWorkWindow(id);
  return NextResponse.json({ ok: true });
}
