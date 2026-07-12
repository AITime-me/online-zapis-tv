import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTE_LENGTH = 32;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidTokenHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
