import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  BotSettingsValidationError,
  getBotSettings,
  updateBotSettings,
} from "@/services/BotSettingsService";
import type { BotSettingsWriteInput } from "@/types/bot-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function botSettingsErrorResponse(error: unknown): NextResponse {
  if (error instanceof BotSettingsValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: false, error: "Не удалось обработать настройки бота" },
    { status: 500 },
  );
}

export async function GET() {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const settings = await getBotSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return botSettingsErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRoles(BOT_SETTINGS_EDIT_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body = (await request.json()) as BotSettingsWriteInput;
    const settings = await updateBotSettings(body, authResult.user.id);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return botSettingsErrorResponse(error);
  }
}
