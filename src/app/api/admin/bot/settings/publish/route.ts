import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  BotSettingsPublicationError,
  publishCurrentBotSettings,
} from "@/services/BotSettingsPublicationService";
import { BotSettingsValidationError } from "@/services/BotSettingsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof BotSettingsValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof BotSettingsPublicationError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  return NextResponse.json(
    { ok: false, error: "Не удалось опубликовать настройки бота" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const result = await publishCurrentBotSettings(authResult.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
