import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  BotKnowledgePublicationError,
  publishCurrentKnowledge,
} from "@/services/BotKnowledgePublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof BotKnowledgePublicationError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status },
    );
  }
  return NextResponse.json(
    { ok: false, error: "Не удалось опубликовать базу знаний" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const result = await publishCurrentKnowledge(authResult.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
