import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  getBotSettingsPublicationState,
  listBotSettingsPublications,
} from "@/services/BotSettingsPublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 20;

  const [publications, state] = await Promise.all([
    listBotSettingsPublications(Number.isFinite(limit) ? limit : 20),
    getBotSettingsPublicationState(),
  ]);

  return NextResponse.json({ ok: true, publications, state });
}
