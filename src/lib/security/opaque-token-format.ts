export const OPAQUE_TOKEN_BYTES = 32;
export const OPAQUE_TOKEN_BASE64URL_LENGTH = 43;

const OPAQUE_TOKEN_RE = new RegExp(
  `^[A-Za-z0-9_-]{${OPAQUE_TOKEN_BASE64URL_LENGTH}}$`,
);

/**
 * Client/server-safe structural check for our opaque bearer tokens.
 * This module intentionally has no Node-only imports.
 */
export function isPlausibleOpaqueToken(token: string): boolean {
  return OPAQUE_TOKEN_RE.test(token);
}
