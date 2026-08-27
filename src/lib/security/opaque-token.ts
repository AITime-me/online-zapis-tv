import { createHash, randomBytes } from "node:crypto";

export const OPAQUE_TOKEN_BYTES = 32;
export const OPAQUE_TOKEN_BASE64URL_LENGTH = 43;

export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

export function isPlausibleOpaqueToken(token: string): boolean {
  return new RegExp(
    `^[A-Za-z0-9_-]{${OPAQUE_TOKEN_BASE64URL_LENGTH}}$`,
  ).test(token);
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
