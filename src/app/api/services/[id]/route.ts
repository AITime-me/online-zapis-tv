import { NextResponse } from "next/server";
import {
  requireApiRoles,
  MANAGE_SERVICES_ROLES,
} from "@/lib/auth/api-access";
import {
  ServiceAdminNotFoundError,
  ServiceAdminValidationError,
  updateService,
} from "@/services/ServiceAdminService";
import type { ServiceWriteInput } from "@/types/service-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(MANAGE_SERVICES_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as Partial<ServiceWriteInput>;
    const service = await updateService(id, body);
    return NextResponse.json({ ok: true, service });
  } catch (error) {
    if (error instanceof ServiceAdminValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ServiceAdminNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
      );
    }
    throw error;
  }
}
