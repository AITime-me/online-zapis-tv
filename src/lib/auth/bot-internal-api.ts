import "server-only";

import { NextResponse } from "next/server";
import { enforceBotInternalAuth } from "@/lib/auth/bot-internal-auth";
import { enforceEndpointRateLimit } from "@/lib/security/rate-limit/enforce-policy";

/**
 * Approved S2S entry for `/api/internal/bot/v1/*` App Router handlers.
 * Centralizes Bearer auth + botInternal rate-limit before the route body runs.
 * CSRF is intentionally not applied (S2S Bearer contract).
 */
export type BotInternalRouteHandler = (
  request: Request,
) => Promise<NextResponse> | NextResponse;

export function withBotInternalApi(
  handler: BotInternalRouteHandler,
): BotInternalRouteHandler {
  return async (request: Request) => {
    const authResponse = enforceBotInternalAuth(request);
    if (authResponse) {
      return authResponse;
    }

    const rateLimitResponse = enforceEndpointRateLimit(request, "botInternal");
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    return handler(request);
  };
}

/** Marker string used by static namespace coverage (must stay in this module). */
export const BOT_INTERNAL_API_WRAPPER_NAME = "withBotInternalApi";
