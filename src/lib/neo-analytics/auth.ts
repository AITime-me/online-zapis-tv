import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseBearerAuthorizationHeader } from "@/lib/auth/bot-internal-auth";
import { buildEndpointRateLimitKey } from "@/lib/security/rate-limit/client-identity";
import { consumeRateLimit } from "@/lib/security/rate-limit/store";

const MIN_TOKEN_LENGTH = 32;
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;

function configuredToken(): string | null {
  const token = process.env.NEO_ANALYTICS_API_TOKEN?.trim();
  const botToken = process.env.BOT_INTERNAL_API_TOKEN?.trim();
  if (
    !token ||
    token.length < MIN_TOKEN_LENGTH ||
    token === botToken ||
    !/^[\x21-\x7E]+$/.test(token)
  ) {
    return null;
  }
  return token;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "UNAUTHORIZED", error: "Unauthorized" },
    { status: 401 },
  );
}

export type NeoAnalyticsHandler = (request: Request) => Promise<NextResponse>;

export function withNeoAnalyticsAuth(handler: NeoAnalyticsHandler): NeoAnalyticsHandler {
  return async (request) => {
    const expected = configuredToken();
    const presented = parseBearerAuthorizationHeader(
      request.headers.get("authorization"),
    );
    if (!expected || !presented || !secureEqual(expected, presented)) {
      return unauthorized();
    }

    const key = buildEndpointRateLimitKey(
      "neo-analytics",
      request.headers,
      ["neo-analytics-s2s-principal"],
    );
    const decision = consumeRateLimit(key, WINDOW_MS, MAX_REQUESTS);
    if (!decision.allowed) {
      return NextResponse.json(
        { ok: false, code: "RATE_LIMITED", error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, decision.retryAfterSeconds)) },
        },
      );
    }
    return handler(request);
  };
}
