import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTE_LENGTH = 32;

/** Криптостойкий bearer-токен для manage-link (только в URL / одноразовой выдаче клиенту). */
export function createManageToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

/** SHA-256 hex; необратим для токена с энтропией 256 бит. Совпадает с pgcrypto digest(..., 'sha256'). */
export function hashManageToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isManageTokenHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Fingerprint для rate-limit / логов: HMAC не нужен отдельно —
 * достаточно усечённого hash предъявленного токена (не raw token).
 */
export function manageTokenRateLimitFingerprint(token: string): string {
  return hashManageToken(token).slice(0, 32);
}

export function secureCompareHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function buildManageUrl(token: string): string {
  return `/booking/manage?token=${encodeURIComponent(token)}`;
}

/** Несекретный корреляционный id для LegalAcceptance.requestReference (не manage token). */
export function createPublicRequestReference(): string {
  return randomBytes(16).toString("hex");
}
