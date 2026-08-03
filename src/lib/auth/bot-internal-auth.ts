import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Минимальная длина BOT_INTERNAL_API_TOKEN (как AUTH_SECRET / SCHEDULE_VIEW_TOKEN). */
export const BOT_INTERNAL_API_TOKEN_MIN_LENGTH = 32;

const UNAUTHORIZED_BODY = {
  ok: false as const,
  code: "UNAUTHORIZED" as const,
  error: "Unauthorized",
};

function secureCompareUtf8(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "utf8");
    const b = Buffer.from(right, "utf8");
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Server-side token for bot S2S routes.
 * Missing / too-short → null (fail-closed at the route helper).
 * Not part of global env zod required set — see docs/architecture/bot-internal-api-pr-a.md.
 */
export function getBotInternalApiToken(): string | null {
  const token = process.env.BOT_INTERNAL_API_TOKEN?.trim();
  if (!token || token.length < BOT_INTERNAL_API_TOKEN_MIN_LENGTH) {
    return null;
  }
  return token;
}

/**
 * Parse `Authorization: Bearer <token>`.
 * Rejects missing header, wrong scheme, extra parts, empty token.
 * Does not log the header or token.
 */
export function parseBearerAuthorizationHeader(
  header: string | null | undefined,
): string | null {
  if (header == null) {
    return null;
  }

  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex <= 0) {
    return null;
  }

  const scheme = trimmed.slice(0, spaceIndex);
  const token = trimmed.slice(spaceIndex + 1).trim();
  // Strict token: printable ASCII only, no whitespace/control/unicode junk.
  if (
    scheme.toLowerCase() !== "bearer" ||
    !token ||
    token.length > 512 ||
    !/^[\x21-\x7E]+$/.test(token)
  ) {
    return null;
  }

  return token;
}

export function isValidBotInternalBearerToken(
  candidate: string | null | undefined,
): boolean {
  const expected = getBotInternalApiToken();
  if (!expected || !candidate) {
    return false;
  }
  return secureCompareUtf8(expected, candidate);
}

export function unauthorizedBotInternalResponse(): NextResponse {
  return NextResponse.json(UNAUTHORIZED_BODY, {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Fail-closed Bearer gate for `/api/internal/bot/v1/*`.
 * Returns a 401 response when auth fails; null when the request may proceed.
 */
export function enforceBotInternalAuth(request: Request): NextResponse | null {
  const expected = getBotInternalApiToken();
  if (!expected) {
    return unauthorizedBotInternalResponse();
  }

  const presented = parseBearerAuthorizationHeader(
    request.headers.get("authorization"),
  );
  if (!presented || !secureCompareUtf8(expected, presented)) {
    return unauthorizedBotInternalResponse();
  }

  return null;
}
