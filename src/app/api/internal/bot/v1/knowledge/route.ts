import { NextResponse } from "next/server";
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_KNOWLEDGE_NOT_PUBLISHED_CODE,
  BOT_KNOWLEDGE_PUBLICATION_INVALID_CODE,
} from "@/lib/bot-knowledge/publication-contract";
import { BotKnowledgePublicationPayloadError } from "@/lib/bot-knowledge/publication-payload";
import {
  BotKnowledgePublicationError,
  getActiveBotKnowledgeRuntimePublication,
} from "@/services/BotKnowledgePublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "updatedByUserId",
  "publishedByUserId",
  "createdByUserId",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "password",
  "authorization",
  "price",
  "priceFrom",
  "priceTo",
  "duration",
  "durationMinutes",
]);

function assertRuntimeResponseSafe(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertRuntimeResponseSafe(entry);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
      throw new BotKnowledgePublicationError(
        "Runtime response contains forbidden key",
        "CONFLICT",
      );
    }
    assertRuntimeResponseSafe(entry);
  }
}

export const GET = withBotInternalApi(async () => {
  try {
    const publication = await getActiveBotKnowledgeRuntimePublication();
    if (!publication) {
      return NextResponse.json(
        {
          ok: false as const,
          code: BOT_KNOWLEDGE_NOT_PUBLISHED_CODE,
          error: "Bot knowledge is not published",
        },
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    const body = {
      ok: true as const,
      schemaVersion: publication.schemaVersion,
      knowledgePublicationId: publication.knowledgePublicationId,
      version: publication.version,
      checksum: publication.checksum,
      publishedAt: publication.publishedAt,
      entries: publication.entries,
    };

    assertRuntimeResponseSafe(body);

    return NextResponse.json(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (
      error instanceof BotKnowledgePublicationError ||
      error instanceof BotKnowledgePublicationPayloadError
    ) {
      return NextResponse.json(
        {
          ok: false as const,
          code: BOT_KNOWLEDGE_PUBLICATION_INVALID_CODE,
          error: "Active knowledge publication is invalid",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false as const,
        code: "INTERNAL_ERROR",
        error: "Failed to load bot knowledge publication",
      },
      { status: 500 },
    );
  }
});
