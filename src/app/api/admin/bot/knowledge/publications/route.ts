import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import {
  getBotKnowledgePublicationState,
  listBotKnowledgePublications,
} from "@/services/BotKnowledgePublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const [state, publications] = await Promise.all([
      getBotKnowledgePublicationState(),
      listBotKnowledgePublications(20),
    ]);
    return NextResponse.json({ ok: true, state, publications });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось загрузить публикации knowledge" },
      { status: 500 },
    );
  }
}
