import { NextResponse } from "next/server";

export const PUBLIC_RATE_LIMIT_MESSAGE =
  "Слишком много запросов. Пожалуйста, подождите немного и попробуйте снова";

/** Fixed internal bot S2S envelope (English, no public booking copy). */
export const BOT_INTERNAL_RATE_LIMIT_MESSAGE = "Too many requests";

export function buildRateLimitJsonBody(message = PUBLIC_RATE_LIMIT_MESSAGE) {
  return {
    ok: false as const,
    error: message,
    code: "RATE_LIMITED" as const,
  };
}

export function buildBotInternalRateLimitJsonBody() {
  return buildRateLimitJsonBody(BOT_INTERNAL_RATE_LIMIT_MESSAGE);
}

export function createRateLimitResponse(
  retryAfterSeconds: number,
  message: string = PUBLIC_RATE_LIMIT_MESSAGE,
): NextResponse {
  return NextResponse.json(buildRateLimitJsonBody(message), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(Math.max(1, retryAfterSeconds)),
    },
  });
}

export function createBotInternalRateLimitResponse(
  retryAfterSeconds: number,
): NextResponse {
  return createRateLimitResponse(
    retryAfterSeconds,
    BOT_INTERNAL_RATE_LIMIT_MESSAGE,
  );
}
