import { NextResponse } from "next/server";
import { requireApiRoles, MANAGE_MASTERS_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  createMaster,
  listMasters,
  MasterAdminConflictError,
  MasterAdminValidationError,
} from "@/services/MasterAdminService";
import type { MasterWriteInput } from "@/types/master-admin";

export async function GET(request: Request) {
  const authResult = await requireApiRoles(MANAGE_MASTERS_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("includeInactive") === "true";
  const masters = await listMasters(includeInactive);

  return NextResponse.json({ ok: true, masters });
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(MANAGE_MASTERS_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as MasterWriteInput;
    const master = await createMaster(body);
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
    throw error;
  }
}
