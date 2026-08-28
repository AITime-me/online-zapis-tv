import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  activateBotSettingsPublication,
  BotSettingsPublicationError,
} from "@/services/BotSettingsPublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function errorResponse(error: unknown): NextResponse {
  if (error instanceof BotSettingsPublicationError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  return NextResponse.json(
    { ok: false, error: "Не удалось активировать публикацию" },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const publication = await activateBotSettingsPublication(id, authResult.user.id);
    return NextResponse.json({ ok: true, publication });
  } catch (error) {
    return errorResponse(error);
  }
}
