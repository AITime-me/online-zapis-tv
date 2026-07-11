import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  ClientImportValidationError,
  commitClientImport,
  previewClientImport,
} from "@/services/ClientImportService";
import type { ClientImportCommitRow } from "@/types/client-import";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function importErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientImportValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось обработать файл импорта" },
    { status: 500 },
  );
}

type PreviewBody = {
  csvText?: string;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(CLIENTS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  const csvText = typeof body.csvText === "string" ? body.csvText : "";
  if (!csvText.trim()) {
    return NextResponse.json(
      { ok: false, error: "Не передан CSV-файл" },
      { status: 400 },
    );
  }

  try {
    const preview = await previewClientImport(csvText);
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return importErrorResponse(error);
  }
}
