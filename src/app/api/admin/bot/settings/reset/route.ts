import { NextResponse } from "next/server";
import { BOT_SETTINGS_EDIT_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  BotSettingsValidationError,
  resetBotSettings,
} from "@/services/BotSettingsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const settings = await resetBotSettings(authResult.user.id);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    if (error instanceof BotSettingsValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: false, error: "Не удалось сбросить настройки бота" },
      { status: 500 },
    );
  }
}
