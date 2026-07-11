/**
 * Node.js server-only rate limit hashing (HMAC-SHA256).
 * Do not import from Edge middleware.
 */
import { createHmac } from "node:crypto";

const DEV_FALLBACK_SALT = "dev-rate-limit-salt-not-for-production";

function resolveSalt(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "";

  if (secret.length >= 16) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    return "production-rate-limit-fallback";
  }

  return DEV_FALLBACK_SALT;
}

export function hashRateLimitIdentity(parts: string[]): string {
  const normalized = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("|");

  return createHmac("sha256", resolveSalt()).update(normalized).digest("hex");
}

/**
 * In-memory rate limiting is reliable only within a single Node process.
 * Multi-instance deployments require Redis/shared store.
 * Reverse-proxy rate limiting remains mandatory on staging/production.
 */
