import { NextResponse } from "next/server";
import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_LIVE_FACTS_OWNERSHIP_INVARIANT,
  BotLiveFactsPayloadError,
} from "@/lib/bot-api/live-facts-contract";
import { safeLogError } from "@/lib/logging/redact";
import { buildBotLiveFactsPayload } from "@/services/BotLiveFactsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/internal/bot/v1/live-facts
 *
 * Current LIVE business facts for bot-TV (schemaVersion=1).
 * Auth: BOT_INTERNAL_API_TOKEN via withBotInternalApi.
 * Cache-Control: no-store — mutable SoT must not be cached as authority.
 *
 * Fact ownership: LIVE_FACTS wins over KB prose for price/duration/masters/
 * bookingMode/active state/structured studio fields
 * (`BOT_LIVE_FACTS_OWNERSHIP_INVARIANT`).
 *
 * Does not read BotKnowledge* or BotSettings publications.
 * Does not return availability/slots (use available-days / slots).
 */
void BOT_LIVE_FACTS_OWNERSHIP_INVARIANT;

export const GET = withBotInternalApi(async () => {
  try {
    const payload = await buildBotLiveFactsPayload();

    return NextResponse.json(
      {
        ok: true as const,
        ...payload,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    safeLogError("bot-internal-live-facts", error);

    if (error instanceof BotLiveFactsPayloadError) {
      return NextResponse.json(
        {
          ok: false as const,
          code: "INTERNAL_ERROR" as const,
          error: "Internal error",
        },
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    // Fail closed — never return partial fabricated defaults.
    return NextResponse.json(
      {
        ok: false as const,
        code: "INTERNAL_ERROR" as const,
        error: "Internal error",
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
});
