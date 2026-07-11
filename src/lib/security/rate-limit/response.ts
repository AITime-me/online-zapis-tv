import { NextResponse } from "next/server";

export const PUBLIC_RATE_LIMIT_MESSAGE =
  "Слишком много запросов. Пожалуйста, подождите немного и попробуйте снова";

export function buildRateLimitJsonBody(message = PUBLIC_RATE_LIMIT_MESSAGE) {
  return {
    ok: false as const,
    error: message,
    code: "RATE_LIMITED",
  };
}

export function createRateLimitResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(buildRateLimitJsonBody(), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(Math.max(1, retryAfterSeconds)),
    },
  });
}
