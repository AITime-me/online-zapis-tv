/**
 * Строгое HMAC-SHA256 для DB-backed login throttle.
 * Отдельно от in-memory rate-limit hashing: без фиксированного production fallback.
 */
import { createHmac } from "node:crypto";

/** Минимальная длина серверного секрета для HMAC identity. */
export const LOGIN_THROTTLE_HMAC_MIN_SECRET_LENGTH = 16;

/** Явно обозначенный локальный fallback только для development/test. */
const DEV_LOCAL_HMAC_FALLBACK = "dev-login-throttle-hmac-local-only";

export class LoginThrottleUnavailableError extends Error {
  constructor() {
    super("login throttle unavailable");
    this.name = "LoginThrottleUnavailableError";
  }
}

export function isStrictLoginThrottleRuntime(): boolean {
  const appEnv = process.env.APP_ENV?.trim();
  if (appEnv === "staging" || appEnv === "production") {
    return true;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    return true;
  }

  return false;
}

export function resolveLoginThrottleHmacSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "";

  if (secret.length >= LOGIN_THROTTLE_HMAC_MIN_SECRET_LENGTH) {
    return secret;
  }

  if (isStrictLoginThrottleRuntime()) {
    throw new LoginThrottleUnavailableError();
  }

  return DEV_LOCAL_HMAC_FALLBACK;
}

export function hashLoginThrottleIdentity(parts: string[]): string {
  const secret = resolveLoginThrottleHmacSecret();
  const normalized = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("|");

  return createHmac("sha256", secret).update(normalized).digest("hex");
}
