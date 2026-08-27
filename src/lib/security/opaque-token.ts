import { createHash, randomBytes } from "node:crypto";
import { OPAQUE_TOKEN_BYTES } from "./opaque-token-format";

export {
  OPAQUE_TOKEN_BYTES,
  OPAQUE_TOKEN_BASE64URL_LENGTH,
  isPlausibleOpaqueToken,
} from "./opaque-token-format";

export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
