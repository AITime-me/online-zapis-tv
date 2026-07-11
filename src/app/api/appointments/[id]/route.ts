import { NextResponse } from "next/server";
import { requireApiRoles, WRITE_SCHEDULE_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  cancelAppointment,
  updateAppointment,
  type AppointmentWriteInput,
} from "@/services/AppointmentService";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(WRITE_SCHEDULE_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const body = (await request.json()) as Partial<AppointmentWriteInput>;
    const appointment = await updateAppointment(id, body);
    return NextResponse.json({ ok: true, appointment });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AppointmentValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(WRITE_SCHEDULE_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const appointment = await cancelAppointment(id);
    return NextResponse.json({ ok: true, appointment });
  } catch (error) {
    if (error instanceof AppointmentValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
