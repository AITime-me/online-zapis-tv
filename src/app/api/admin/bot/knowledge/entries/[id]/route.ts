import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  BOT_SETTINGS_VIEW_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  BotKnowledgeEntryError,
  getBotKnowledgeEntry,
  updateBotKnowledgeEntry,
} from "@/services/BotKnowledgeEntryService";
import type { BotKnowledgeCategoryId } from "@/lib/bot-knowledge/publication-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(BOT_SETTINGS_VIEW_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    const entry = await getBotKnowledgeEntry(id);
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(BOT_SETTINGS_EDIT_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

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

  try {
    const entry = await updateBotKnowledgeEntry(
      id,
      {
        stableKey:
          typeof record.stableKey === "string" ? record.stableKey : undefined,
        category:
          typeof record.category === "string"
            ? (record.category as BotKnowledgeCategoryId)
            : undefined,
        title: typeof record.title === "string" ? record.title : undefined,
        content: typeof record.content === "string" ? record.content : undefined,
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
