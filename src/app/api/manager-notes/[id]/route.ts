import { NextResponse } from "next/server";
import {
  WRITE_SCHEDULE_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  deleteManagerNote,
  ManagerNoteNotFoundError,
  ManagerNoteValidationError,
  updateManagerNote,
} from "@/services/ManagerNoteService";

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
    const body = (await request.json()) as { content?: string };
    if (typeof body.content !== "string") {
      return NextResponse.json(
        { ok: false, error: "content is required" },
        { status: 400 },
      );
    }

    const note = await updateManagerNote(id, body.content);
    return NextResponse.json({ ok: true, note });
  } catch (error) {
    if (error instanceof ManagerNoteValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ManagerNoteNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
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
    await deleteManagerNote(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ManagerNoteNotFoundError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 },
      );
    }
    throw error;
  }
}
