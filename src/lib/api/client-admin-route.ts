import { NextResponse } from "next/server";
import { ClientAdminValidationError } from "@/services/ClientAdminService";
import type { ClientAdminPatchBody } from "@/types/client-admin";
import { toApiErrorBody } from "@/lib/errors/format-service-error";

export async function readClientAdminWriteBody(
  request: Request,
): Promise<ClientAdminPatchBody | NextResponse> {
  try {
    return (await request.json()) as ClientAdminPatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }
}

export function clientAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientAdminValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(toApiErrorBody(error), { status: 500 });
}
