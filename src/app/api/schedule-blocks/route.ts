import { NextResponse } from "next/server";
import {
  requireApiRoles,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import {
  createScheduleBlock,
  ScheduleBlockConflictError,
  ScheduleBlockValidationError,
  type ScheduleBlockWriteInput,
} from "@/services/ScheduleBlockService";

export async function POST(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ScheduleBlockWriteInput;
    const block = await createScheduleBlock(body, authResult.user.id);
    return NextResponse.json({ ok: true, block });
  } catch (error) {
    if (error instanceof ScheduleBlockConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof ScheduleBlockValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
