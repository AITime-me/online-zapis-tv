import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import { listClientsForAdmin } from "@/services/ClientAdminService";
import {
  ClientImportValidationError,
  commitClientImport,
} from "@/services/ClientImportService";
import type { ClientImportCommitRow } from "@/types/client-import";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function importErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientImportValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось импортировать клиентов" },
    { status: 500 },
  );
}

type CommitBody = {
  rows?: ClientImportCommitRow[];
};

function isCommitRow(value: unknown): value is ClientImportCommitRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as ClientImportCommitRow;
  return (
    typeof row.rowNumber === "number" &&
    (row.action === "create" || row.action === "update") &&
    typeof row.data === "object" &&
    row.data !== null &&
    typeof row.data.fullName === "string"
  );
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(CLIENTS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: CommitBody;
  try {
    body = (await request.json()) as CommitBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  const rows = Array.isArray(body.rows) ? body.rows.filter(isCommitRow) : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Нет строк для импорта" },
      { status: 400 },
    );
  }

  try {
    const result = await commitClientImport(rows);
    const clients = await listClientsForAdmin();
    return NextResponse.json({ ok: true, result, clients });
  } catch (error) {
    return importErrorResponse(error);
  }
}
