import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  ClientMergeValidationError,
  previewClientMerge,
} from "@/services/ClientMergeService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function mergeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientMergeValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось подготовить предпросмотр объединения" },
    { status: 500 },
  );
}

type PreviewBody = {
  clientIds?: string[];
  targetClientId?: string;
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

  const clientIds = Array.isArray(body.clientIds)
    ? body.clientIds.filter((id): id is string => typeof id === "string")
    : [];

  if (clientIds.length < 2) {
    return NextResponse.json(
      { ok: false, error: "Укажите минимум двух клиентов для объединения" },
      { status: 400 },
    );
  }

  try {
    const preview = await previewClientMerge(
      clientIds,
      typeof body.targetClientId === "string" ? body.targetClientId : undefined,
    );
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return mergeErrorResponse(error);
  }
}
