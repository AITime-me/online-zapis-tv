import { NextResponse } from "next/server";

import { isMutatingMethod } from "@/lib/security/csrf-route-rules";

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getTrustedAppOrigins(): string[] {
  const origins = new Set<string>();

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  const authUrlOrigin = parseOrigin(process.env.AUTH_URL?.trim());
  if (authUrlOrigin) {
    origins.add(authUrlOrigin);
  }

  return [...origins];
}

export function hasSessionAuthCookie(
  cookies: { get(name: string): { value: string } | undefined },
): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(cookies.get(name)?.value));
}

export function validateSameOriginRequest(request: Request): boolean {
  const trustedOrigins = getTrustedAppOrigins();
  if (trustedOrigins.length === 0) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    return trustedOrigins.includes(origin);
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return true;
  }

  if (secFetchSite === "cross-site") {
    return false;
  }

  return false;
}

export function createCsrfForbiddenResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false as const,
      error: "Forbidden",
      code: "CSRF_ORIGIN",
    },
    { status: 403 },
  );
}

export function enforceSameOriginForMutatingRequest(
  request: Request,
): NextResponse | null {
  if (!isMutatingMethod(request.method)) {
    return null;
  }

  if (!validateSameOriginRequest(request)) {
    return createCsrfForbiddenResponse();
  }

  return null;
}
