import { NextResponse } from "next/server";
import type { AppointmentSource, AppointmentStatus } from "@prisma/client";
import {
  requireApiRoles,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointment,
  type AppointmentWriteInput,
} from "@/services/AppointmentService";

export async function POST(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as AppointmentWriteInput;
    const appointment = await createAppointment(body, authResult.user.id);
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

export type { AppointmentStatus, AppointmentSource };
