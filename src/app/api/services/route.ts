import { NextResponse } from "next/server";
import {
  requireApiRoles,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import {
  createService,
  getServiceAdminPageData,
  ServiceAdminValidationError,
} from "@/services/ServiceAdminService";
import type { ServiceWriteInput } from "@/types/service-admin";

export async function GET() {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const {
    services,
    filterCategories,
    filterMasters,
    formCategories,
    formMasters,
  } = await getServiceAdminPageData();

  return NextResponse.json({
    ok: true,
    services,
    filterCategories,
    filterMasters,
    formCategories,
    formMasters,
  });
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ServiceWriteInput;
    const service = await createService(body);
    return NextResponse.json({ ok: true, service });
  } catch (error) {
    if (error instanceof ServiceAdminValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
