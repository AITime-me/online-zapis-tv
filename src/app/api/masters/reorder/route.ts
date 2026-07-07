import { NextResponse } from "next/server";
import {
  requireApiRoles,
  MANAGE_MASTERS_ROLES,
} from "@/lib/auth/api-access";
import {
  MasterAdminValidationError,
  reorderMasters,
} from "@/services/MasterAdminService";
import type { MasterReorderInput } from "@/types/master-admin";

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(MANAGE_MASTERS_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as MasterReorderInput;
    const masters = await reorderMasters(body);
    return NextResponse.json({ ok: true, masters });
  } catch (error) {
    if (error instanceof MasterAdminValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
