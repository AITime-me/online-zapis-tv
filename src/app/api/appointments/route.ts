import { NextResponse } from "next/server";
import type { AppointmentSource, AppointmentStatus } from "@prisma/client";
import {
  WRITE_SCHEDULE_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { creatorKindFromAuthenticatedRole } from "@/lib/schedule/appointment-creator-kind";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointment,
  type AppointmentWriteInput,
} from "@/services/AppointmentService";

type ManualCreateAppointmentBody = AppointmentWriteInput & {
  allowAppointmentOverlap?: unknown;
  creatorKind?: unknown;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    WRITE_SCHEDULE_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ManualCreateAppointmentBody;
    const allowAppointmentOverlap = body.allowAppointmentOverlap === true;
    const appointmentInput: AppointmentWriteInput = { ...body };
    Reflect.deleteProperty(
      appointmentInput as Record<string, unknown>,
      "allowAppointmentOverlap",
    );
    // Never trust client-supplied creator provenance.
    Reflect.deleteProperty(
      appointmentInput as Record<string, unknown>,
      "creatorKind",
    );

    const result = await createAppointment(
      appointmentInput,
      authResult.user.id,
      {
        allowAppointmentOverlap,
        creatorKind: creatorKindFromAuthenticatedRole(authResult.user.role),
      },
    );
    return NextResponse.json({
      ok: true,
      appointment: result.appointment,
      clientLink: result.clientLink,
    });
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.conflictType ? { conflictType: error.conflictType } : {}),
        },
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

export type { AppointmentStatus, AppointmentSource };
