import { NextResponse } from "next/server";
import { UserAdminValidationError } from "@/services/UserAdminService";
import type { UserAdminUpdateInput } from "@/types/user-admin";
import { toApiErrorBody } from "@/lib/errors/format-service-error";

export type UserAdminPatchBody = UserAdminUpdateInput & {
  id?: string;
};

export async function readUserAdminWriteBody(
  request: Request,
): Promise<UserAdminPatchBody | NextResponse> {
  try {
    return (await request.json()) as UserAdminPatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }
}

export function userAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof UserAdminValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(toApiErrorBody(error), { status: 500 });
}
