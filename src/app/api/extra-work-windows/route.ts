import { NextResponse } from "next/server";
import {
  requireApiRoles,
  WRITE_SCHEDULE_ROLES,
} from "@/lib/auth/api-access";
import {
  createExtraWorkWindow,
  ExtraWorkValidationError,
  type ExtraWorkWriteInput,
} from "@/services/ExtraWorkWindowService";

export async function POST(request: Request) {
  const authResult = await requireApiRoles(WRITE_SCHEDULE_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as ExtraWorkWriteInput;
    const window = await createExtraWorkWindow(body, authResult.user.id);
    return NextResponse.json({ ok: true, extraWorkWindow: window });
  } catch (error) {
    if (error instanceof ExtraWorkValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
