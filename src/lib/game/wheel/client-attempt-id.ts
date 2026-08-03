/**
 * Browser-safe attemptId helpers for Wheel of Fortune.
 * Uses Web Crypto only. No Node crypto imports, no server secrets,
 * no sessionToken derivation.
 * Create once before spin submit; reuse on retry / double-click.
 */

/** Browser creates once before spin submit and reuses on retry/double-click. */
export function createWheelAttemptId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Secure random UUID is unavailable in this environment");
}

export function isValidWheelAttemptId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  // UUID v4-ish or other opaque 16–128 char id
  return trimmed.length >= 16 && trimmed.length <= 128;
}
