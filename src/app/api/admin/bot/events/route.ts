import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { parseBotEventLogListQuery } from "@/lib/bot-settings/list-query";
import { listBotEventLogsPaginated } from "@/services/BotEventLogService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const query = parseBotEventLogListQuery(new URL(request.url).searchParams);
  const result = await listBotEventLogsPaginated(query);

  return NextResponse.json({ ok: true, ...result });
}
