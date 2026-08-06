import "server-only";

import { NextResponse } from "next/server";
import {
  enforceBotInternalAuth,
} from "@/lib/auth/bot-internal-auth";
import { checkRateLimitByPolicy } from "@/lib/security/rate-limit/check";
import { shouldBypassRateLimitForIsolatedWheelE2e } from "@/lib/security/rate-limit/enforce-policy";
import { createBotInternalRateLimitResponse } from "@/lib/security/rate-limit/response";
import type { RateLimitPolicyId } from "@/lib/security/rate-limit/types";

/**
 * Approved S2S entry for `/api/internal/bot/v1/*` App Router handlers.
 * Centralizes Bearer auth + rate-limit before the route body runs.
 * CSRF is intentionally not applied (S2S Bearer contract).
 *
 * Process-local write rate limiter is valid only under the documented
 * single-instance app topology invariant (see docs + compose guards).
 */
export type BotInternalRouteHandler = (
  request: Request,
) => Promise<NextResponse> | NextResponse;

export type WithBotInternalApiOptions = {
  /**
   * Override shared `botInternal` bucket (e.g. create-specific write limit).
   */
  rateLimitPolicy?: RateLimitPolicyId;
};

/** Stable principal marker after successful Bearer auth (not IP-only). */
export const BOT_INTERNAL_RATE_LIMIT_PRINCIPAL = "bot-internal-s2s-principal";

export function withBotInternalApi(
  handler: BotInternalRouteHandler,
  options?: WithBotInternalApiOptions,
): BotInternalRouteHandler {
  const policyId = options?.rateLimitPolicy ?? "botInternal";

  return async (request: Request) => {
    const authResponse = enforceBotInternalAuth(request);
    if (authResponse) {
      return authResponse;
    }

    if (!shouldBypassRateLimitForIsolatedWheelE2e()) {
      const decision = checkRateLimitByPolicy(
        policyId,
        request.headers,
        [BOT_INTERNAL_RATE_LIMIT_PRINCIPAL],
      );
      if (!decision.allowed) {
        return createBotInternalRateLimitResponse(decision.retryAfterSeconds);
      }
    }

    return handler(request);
  };
}

/** Marker string used by static namespace coverage (must stay in this module). */
export const BOT_INTERNAL_API_WRAPPER_NAME = "withBotInternalApi";
