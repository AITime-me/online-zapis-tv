/**
 * HttpOnly session cookie after stripping ?token= from manage page URL.
 *
 * Path must be "/" because both `/booking/manage` and `/api/booking/manage`
 * need the cookie; there is no narrower shared path prefix.
 * Domain is intentionally omitted (host-only cookie).
 */

export const MANAGE_SESSION_COOKIE = "tv_manage_bearer";

/** Session cookie TTL (seconds). Does not expire the underlying manage-link bearer. */
export const MANAGE_SESSION_COOKIE_MAX_AGE_SEC = 60 * 60;

/**
 * Plausible manage bearer shape: opaque base64url from createManageToken()
 * (~43 chars for 32 random bytes). Rejects empty, tiny, huge, and non-base64url.
 */
export function isPlausibleManageBearerToken(token: string): boolean {
  if (!token) {
    return false;
  }
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

export function shouldUseSecureManageCookie(input: {
  protocol: string;
  hostname: string;
  forwardedProto?: string | null;
}): boolean {
  const host = input.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLoopback) {
    return false;
  }

  if (input.protocol === "https:") {
    return true;
  }

  const forwarded = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") {
    return true;
  }

  // Fail closed for non-local production-like hosts even if proto looks http.
  return process.env.NODE_ENV === "production";
}

export function buildManageSessionCookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: "strict";
  path: "/";
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure,
    maxAge: MANAGE_SESSION_COOKIE_MAX_AGE_SEC,
  };
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string {
  if (!cookieHeader) {
    return "";
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) {
      continue;
    }
    try {
      return decodeURIComponent(trimmed.slice(eq + 1).trim());
    } catch {
      return trimmed.slice(eq + 1).trim();
    }
  }

  return "";
}

/**
 * Resolve bearer: body/query first (compat), then httpOnly session cookie.
 * Malformed values are ignored (treated as missing).
 */
export function resolveManageBearerToken(input: {
  request: Request;
  bodyToken?: string | null;
}): string {
  const candidates = [
    typeof input.bodyToken === "string" ? input.bodyToken.trim() : "",
    new URL(input.request.url).searchParams.get("token")?.trim() ?? "",
    readCookieValue(input.request.headers.get("cookie"), MANAGE_SESSION_COOKIE),
  ];

  for (const candidate of candidates) {
    if (isPlausibleManageBearerToken(candidate)) {
      return candidate;
    }
  }

  return "";
}
