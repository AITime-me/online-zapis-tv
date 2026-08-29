import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  BotKnowledgeEntryError,
  createBotKnowledgeEntry,
  listBotKnowledgeEntries,
} from "@/services/BotKnowledgeEntryService";
import {
  getBotKnowledgePublicationState,
} from "@/services/BotKnowledgePublicationService";
import type { BotKnowledgeCategoryId } from "@/lib/bot-knowledge/publication-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof BotKnowledgeEntryError) {
    const status =
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status },
    );
  }
  return NextResponse.json(
    { ok: false, error: "Не удалось обработать knowledge entry" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? undefined;
  const enabledParam = url.searchParams.get("enabled");
  const enabled =
    enabledParam === "enabled" || enabledParam === "archived" || enabledParam === "all"
      ? enabledParam
      : "all";

  try {
    const [entries, publicationState] = await Promise.all([
      listBotKnowledgeEntries({ category, enabled }),
      getBotKnowledgePublicationState(),
    ]);
    return NextResponse.json({ ok: true, entries, publicationState });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Некорректное тело запроса" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const allowed = new Set([
    "stableKey",
    "category",
    "title",
    "content",
    "tags",
    "serviceId",
    "isEnabled",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return NextResponse.json(
        { ok: false, error: `Неизвестное поле: ${key}` },
        { status: 400 },
      );
    }
  }

  if (
    typeof record.stableKey !== "string" ||
    typeof record.category !== "string" ||
    typeof record.title !== "string" ||
    typeof record.content !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "stableKey, category, title, content обязательны" },
      { status: 400 },
    );
  }

  try {
    const entry = await createBotKnowledgeEntry(
      {
        stableKey: record.stableKey,
        category: record.category as BotKnowledgeCategoryId,
        title: record.title,
        content: record.content,
        tags: Array.isArray(record.tags) ? (record.tags as string[]) : undefined,
        serviceId:
          record.serviceId === undefined
            ? undefined
            : record.serviceId === null
              ? null
              : String(record.serviceId),
        isEnabled:
          typeof record.isEnabled === "boolean" ? record.isEnabled : undefined,
      },
      authResult.user.id,
    );
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return errorResponse(error);
  }
}
