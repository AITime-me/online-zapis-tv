import { IDEMPOTENCY_KEY_HEADER } from "@/lib/booking-requests/idempotency-contract";

const STORAGE_PREFIX = "booking-idempotency:";

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope.trim()}`;
}

function formatUuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random generator is unavailable");
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return formatUuidFromBytes(bytes);
}

function readStoredKey(scope: string): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const value = sessionStorage.getItem(storageKey(scope));
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeStoredKey(scope: string, key: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(storageKey(scope), key);
  } catch {
    // Ignore quota / privacy mode errors; caller still receives an in-memory key.
  }
}

function removeStoredKey(scope: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.removeItem(storageKey(scope));
  } catch {
    // Ignore storage errors.
  }
}

export function getOrCreateIdempotencyKey(scope: string): string {
  const existing = readStoredKey(scope);
  if (existing) {
    return existing;
  }

  const key = generateIdempotencyKey();
  writeStoredKey(scope, key);
  return key;
}

export function resetIdempotencyKey(scope: string): string {
  const key = generateIdempotencyKey();
  writeStoredKey(scope, key);
  return key;
}

export function clearIdempotencyKey(scope: string): void {
  removeStoredKey(scope);
}

export function buildIdempotencyHeaders(scope: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: getOrCreateIdempotencyKey(scope),
  };
}
