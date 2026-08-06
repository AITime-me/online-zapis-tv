/**
 * Dedicated HMAC configuration for bot booking idempotency fingerprints.
 * Fail-closed: no auth/session/Bearer token reuse, no hardcoded/random fallbacks.
 */
import "server-only";

export const BOT_IDEMPOTENCY_HMAC_MIN_BYTES = 32;
export const BOT_IDEMPOTENCY_HMAC_PREVIOUS_MAX = 8;

/** Fixed server log code — never includes secret material. */
export const BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE =
  "BOT_IDEMPOTENCY_HMAC_CONFIG_INVALID" as const;

const FORBIDDEN_SECRET_NORMALIZED = new Set([
  "changeme",
  "change-me",
  "change_me",
  "your-secret-here",
  "your_secret_here",
  "example",
  "example-secret",
  "example_secret",
  "replace-me",
  "replace_me",
  "todo",
  "secret",
  "test",
  "password",
]);

export class BotIdempotencyHmacConfigError extends Error {
  readonly code = BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE;

  constructor() {
    super(BOT_IDEMPOTENCY_HMAC_CONFIG_ERROR_CODE);
    this.name = "BotIdempotencyHmacConfigError";
  }
}

export type BotIdempotencyHmacConfig = {
  currentSecret: string;
  previousSecrets: string[];
};

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isForbiddenPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (FORBIDDEN_SECRET_NORMALIZED.has(normalized)) {
    return true;
  }
  if (
    normalized.includes("example") ||
    normalized.includes("changeme") ||
    normalized.includes("change-me") ||
    normalized.includes("replace-me") ||
    normalized.includes("your-secret") ||
    normalized.includes("hmac-fallback") ||
    normalized.includes("not-for-production")
  ) {
    return true;
  }
  return false;
}

function assertValidSecretMaterial(value: string): void {
  if (!value) {
    throw new BotIdempotencyHmacConfigError();
  }
  if (utf8ByteLength(value) < BOT_IDEMPOTENCY_HMAC_MIN_BYTES) {
    throw new BotIdempotencyHmacConfigError();
  }
  if (isForbiddenPlaceholder(value)) {
    throw new BotIdempotencyHmacConfigError();
  }
}

/**
 * Parse and validate dedicated idempotency HMAC secrets from process env.
 * Does not log env values. Throws BotIdempotencyHmacConfigError on any failure.
 */
export function resolveBotIdempotencyHmacConfig(
  env: NodeJS.ProcessEnv = process.env,
): BotIdempotencyHmacConfig {
  const currentRaw = env.BOT_INTERNAL_IDEMPOTENCY_HMAC_SECRET;
  if (currentRaw == null) {
    throw new BotIdempotencyHmacConfigError();
  }
  const currentSecret = currentRaw.trim();
  if (!currentSecret) {
    throw new BotIdempotencyHmacConfigError();
  }
  assertValidSecretMaterial(currentSecret);

  const previousRaw = env.BOT_INTERNAL_IDEMPOTENCY_HMAC_PREVIOUS_SECRETS;
  const previousSecrets: string[] = [];

  if (previousRaw != null && previousRaw.trim() !== "") {
    const parts = previousRaw.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        throw new BotIdempotencyHmacConfigError();
      }
      assertValidSecretMaterial(trimmed);
      previousSecrets.push(trimmed);
    }

    if (previousSecrets.length > BOT_IDEMPOTENCY_HMAC_PREVIOUS_MAX) {
      throw new BotIdempotencyHmacConfigError();
    }

    const seen = new Set<string>();
    for (const secret of previousSecrets) {
      if (seen.has(secret)) {
        throw new BotIdempotencyHmacConfigError();
      }
      seen.add(secret);
      if (secret === currentSecret) {
        throw new BotIdempotencyHmacConfigError();
      }
    }
  }

  return { currentSecret, previousSecrets };
}
