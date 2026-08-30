import { NextResponse } from "next/server";
import {
  BOT_SETTINGS_EDIT_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  BOT_KNOWLEDGE_IMPORT_MAX_BYTES,
  BotKnowledgeEntryError,
  importBotKnowledgeEntries,
} from "@/services/BotKnowledgeEntryService";

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
    { ok: false, error: "Не удалось выполнить импорт базы знаний" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    BOT_SETTINGS_EDIT_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > BOT_KNOWLEDGE_IMPORT_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Файл слишком большой", code: "VALIDATION" },
        { status: 400 },
      );
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось прочитать тело запроса" },
      { status: 400 },
    );
  }

  if (rawText.length > BOT_KNOWLEDGE_IMPORT_MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Файл слишком большой", code: "VALIDATION" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  try {
    const result = await importBotKnowledgeEntries(body, authResult.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
