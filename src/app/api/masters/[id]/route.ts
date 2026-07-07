import { NextResponse } from "next/server";
import {
  requireApiRoles,
  MANAGE_MASTERS_ROLES,
} from "@/lib/auth/api-access";
import {
  MasterAdminConflictError,
  MasterAdminNotFoundError,
  MasterAdminValidationError,
  updateMaster,
} from "@/services/MasterAdminService";
import type { MasterWriteInput } from "@/types/master-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(MANAGE_MASTERS_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as Partial<MasterWriteInput>;
    const master = await updateMaster(id, body);
    return NextResponse.json({ ok: true, master });
  } catch (error) {
    if (error instanceof MasterAdminValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof MasterAdminConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof MasterAdminNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
      );
    }
    throw error;
  }
}
