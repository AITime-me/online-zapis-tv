import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { normalizeGameSlug } from "@/lib/games/catalog-contract";

export const GAME_VISITOR_COOKIE = "game_visitor";
export const SESSION_COOKIE_PREFIX = "gs_";
export const SESSION_COOKIE_HASH_HEX_LENGTH = 24;

export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const PLAY_WINDOW_MS = 30 * 60 * 1000;
export const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SESSION_START_LIMIT = 3;
export const SESSION_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CookieOperation =
  | {
      kind: "set";
      name: string;
      value: string;
      maxAgeSeconds: number;
    }
  | {
      kind: "delete";
      name: string;
    };

export function isProductionCookieRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function buildCatalogSessionCookieName(catalogSlug: string): string {
  const normalized = normalizeGameSlug(catalogSlug);
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${SESSION_COOKIE_PREFIX}${digest.slice(0, SESSION_COOKIE_HASH_HEX_LENGTH)}`;
}

export function remainingMaxAgeSeconds(
  expiresAt: Date,
  now: Date = new Date(),
): number {
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export function buildCookieBaseOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure: isProductionCookieRuntime(),
  };
}

export function applyCookieOperations(
  response: NextResponse,
  operations: CookieOperation[],
): void {
  const base = buildCookieBaseOptions();

  for (const operation of operations) {
    if (operation.kind === "set") {
      response.cookies.set(operation.name, operation.value, {
        ...base,
        maxAge: operation.maxAgeSeconds,
      });
      continue;
    }

    response.cookies.set(operation.name, "", {
      ...base,
      maxAge: 0,
    });
  }
}

export function readRequestCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }
    const value = trimmed.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

export function buildVisitorSetOperation(rawToken: string): CookieOperation {
  return {
    kind: "set",
    name: GAME_VISITOR_COOKIE,
    value: rawToken,
    maxAgeSeconds: VISITOR_COOKIE_MAX_AGE_SECONDS,
  };
}

export function buildSessionSetOperation(
  cookieName: string,
  rawToken: string,
  expiresAt: Date,
  now: Date = new Date(),
): CookieOperation {
  return {
    kind: "set",
    name: cookieName,
    value: rawToken,
    maxAgeSeconds: remainingMaxAgeSeconds(expiresAt, now),
  };
}

export function buildSessionDeleteOperation(cookieName: string): CookieOperation {
  return {
    kind: "delete",
    name: cookieName,
  };
}
