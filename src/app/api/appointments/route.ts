import { NextResponse } from "next/server";
import type { AppointmentSource, AppointmentStatus } from "@prisma/client";
import {
  WRITE_SCHEDULE_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointment,
  type AppointmentWriteInput,
} from "@/services/AppointmentService";

type ManualCreateAppointmentBody = AppointmentWriteInput & {
  allowAppointmentOverlap?: unknown;
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
    const {
      allowAppointmentOverlap: _ignoredOverlapFlag,
      ...appointmentInput
    } = body;

    const appointment = await createAppointment(
      appointmentInput,
      authResult.user.id,
      { allowAppointmentOverlap },
    );
    return NextResponse.json({ ok: true, appointment });
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
