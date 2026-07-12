export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 36;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdempotencyKeyErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID";

export type IdempotencyKeyValidationResult =
  | { ok: true; key: string }
  | { ok: false; code: IdempotencyKeyErrorCode; message: string };

export function isCanonicalUuid(value: string): boolean {
  if (value.length !== IDEMPOTENCY_KEY_MAX_LENGTH) {
    return false;
  }
  return CANONICAL_UUID_PATTERN.test(value);
}

export function validateIdempotencyKeyHeader(
  value: string | null | undefined,
): IdempotencyKeyValidationResult {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Отсутствует заголовок Idempotency-Key",
    };
  }

  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH || !isCanonicalUuid(trimmed)) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_INVALID",
      message: "Некорректный Idempotency-Key",
    };
  }

  return { ok: true, key: trimmed.toLowerCase() };
}
