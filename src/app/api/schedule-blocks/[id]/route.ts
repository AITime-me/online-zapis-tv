import { NextResponse } from "next/server";
import { requireApiRoles, WRITE_SCHEDULE_ROLES, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  deleteScheduleBlock,
  ScheduleBlockConflictError,
  ScheduleBlockValidationError,
  updateScheduleBlock,
  type ScheduleBlockWriteInput,
} from "@/services/ScheduleBlockService";

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
    const body = (await request.json()) as Partial<ScheduleBlockWriteInput>;
    const block = await updateScheduleBlock(id, body);
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

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(WRITE_SCHEDULE_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    await deleteScheduleBlock(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScheduleBlockValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
