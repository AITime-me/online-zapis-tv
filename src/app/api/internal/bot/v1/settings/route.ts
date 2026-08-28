import { NextResponse } from "next/server";
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import { BOT_SETTINGS_NOT_PUBLISHED_CODE } from "@/lib/bot-settings/publication-contract";
import { BotSettingsPublicationPayloadError } from "@/lib/bot-settings/publication-payload";
import {
  BotSettingsPublicationError,
  getActiveBotSettingsRuntimePublication,
} from "@/services/BotSettingsPublicationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FORBIDDEN_RESPONSE_KEYS = new Set([
  "updatedByUserId",
  "publishedByUserId",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "password",
  "authorization",
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
      throw new BotSettingsPublicationError(
        "Runtime response contains forbidden key",
        "CONFLICT",
      );
    }
    assertRuntimeResponseSafe(entry);
  }
}

export const GET = withBotInternalApi(async () => {
  try {
    const publication = await getActiveBotSettingsRuntimePublication();
    if (!publication) {
      return NextResponse.json(
        {
          ok: false as const,
          code: BOT_SETTINGS_NOT_PUBLISHED_CODE,
          error: "Bot settings are not published",
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
      publicationId: publication.publicationId,
      version: publication.version,
      checksum: publication.checksum,
      publishedAt: publication.publishedAt,
      sourceUpdatedAt: publication.sourceUpdatedAt,
      settings: publication.settings,
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
      error instanceof BotSettingsPublicationError ||
      error instanceof BotSettingsPublicationPayloadError
    ) {
      return NextResponse.json(
        {
          ok: false as const,
          code: "BOT_SETTINGS_PUBLICATION_INVALID",
          error: "Active publication is invalid",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false as const,
        code: "INTERNAL_ERROR",
        error: "Failed to load bot settings publication",
      },
      { status: 500 },
    );
  }
});
