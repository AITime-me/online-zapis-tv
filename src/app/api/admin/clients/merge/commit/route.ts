import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import { getClientForAdmin } from "@/services/ClientAdminService";
import {
  ClientMergeValidationError,
  commitClientMerge,
} from "@/services/ClientMergeService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function mergeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientMergeValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось объединить клиентов" },
    { status: 500 },
  );
}

type CommitBody = {
  targetClientId?: string;
  sourceClientIds?: string[];
  reason?: string | null;
};

export async function POST(request: Request) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
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

  const targetClientId =
    typeof body.targetClientId === "string" ? body.targetClientId.trim() : "";
  const sourceClientIds = Array.isArray(body.sourceClientIds)
    ? body.sourceClientIds.filter((id): id is string => typeof id === "string")
    : [];

  if (!targetClientId || sourceClientIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Укажите главного клиента и клиентов для объединения" },
      { status: 400 },
    );
  }

  try {
    const result = await commitClientMerge({
      targetClientId,
      sourceClientIds,
      mergedByUserId: authResult.user.id,
      reason: body.reason,
    });
    const targetClient = await getClientForAdmin(result.targetClientId);
    return NextResponse.json({ ok: true, result, targetClient });
  } catch (error) {
    return mergeErrorResponse(error);
  }
}
