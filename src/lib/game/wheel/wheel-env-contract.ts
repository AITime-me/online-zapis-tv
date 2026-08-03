/**
 * Optional server-only env keys for Wheel of Fortune.
 * Never expose via NEXT_PUBLIC_*. Do not log values or secret fragments.
 */
import "server-only";

export const WHEEL_OPTIONAL_SERVER_ENV_KEYS = [
  "WHEEL_OF_FORTUNE_CAMPAIGN_SECRET",
] as const;

export type WheelOptionalServerEnvKey =
  (typeof WHEEL_OPTIONAL_SERVER_ENV_KEYS)[number];

export const WHEEL_HMAC_MIN_SECRET_LENGTH = 16;

export class WheelSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WheelSecretError";
  }
}

/**
 * Reads optional campaign secret without validating length.
 * Length enforcement belongs to resolveWheelHmacSecret.
 */
export function readOptionalWheelCampaignSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.WHEEL_OF_FORTUNE_CAMPAIGN_SECRET;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Server HMAC secret for phone hashes, attemptId hashes, and deterministic session tokens.
 *
 * Resolution order:
 * 1. WHEEL_OF_FORTUNE_CAMPAIGN_SECRET (if set — must meet min length or fail)
 * 2. AUTH_SECRET / NEXTAUTH_SECRET (legacy-compatible project secrets)
 * 3. production → fail closed (no hardcoded fallback)
 * 4. test → require explicit injected AUTH_SECRET / WHEEL_TEST_HMAC_SECRET
 * 5. development → only explicit WHEEL_DEV_HMAC_SECRET
 */
export function resolveWheelHmacSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const wheelRaw = env.WHEEL_OF_FORTUNE_CAMPAIGN_SECRET;
  if (typeof wheelRaw === "string" && wheelRaw.trim().length > 0) {
    const trimmed = wheelRaw.trim();
    if (trimmed.length < WHEEL_HMAC_MIN_SECRET_LENGTH) {
      throw new WheelSecretError(
        "Configured wheel campaign secret is too short",
      );
    }
    return trimmed;
  }

  const auth =
    env.AUTH_SECRET?.trim() ||
    env.NEXTAUTH_SECRET?.trim() ||
    "";
  if (auth.length >= WHEEL_HMAC_MIN_SECRET_LENGTH) {
    return auth;
  }

  const nodeEnv = env.NODE_ENV ?? "development";

  if (nodeEnv === "production") {
    throw new WheelSecretError("Server secret is required for wheel attempts");
  }

  const testSecret = env.WHEEL_TEST_HMAC_SECRET?.trim() || "";
  if (
    (nodeEnv === "test" || env.SECURITY_BATCH_TEST === "1") &&
    testSecret.length >= WHEEL_HMAC_MIN_SECRET_LENGTH
  ) {
    return testSecret;
  }

  if (nodeEnv === "test" || env.SECURITY_BATCH_TEST === "1") {
    throw new WheelSecretError(
      "Test wheel HMAC secret must be injected explicitly",
    );
  }

  const devSecret = env.WHEEL_DEV_HMAC_SECRET?.trim() || "";
  if (
    nodeEnv === "development" &&
    devSecret.length >= WHEEL_HMAC_MIN_SECRET_LENGTH
  ) {
    return devSecret;
  }

  throw new WheelSecretError("Server secret is required for wheel attempts");
}

export function assertNoPublicWheelSecretsInEnvContract(): void {
  for (const key of WHEEL_OPTIONAL_SERVER_ENV_KEYS) {
    if (key.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`Wheel env key must not be public: ${key}`);
    }
  }
}

export function assertNoHardcodedProductionWheelFallback(
  source: string,
): void {
  // Detect assignment/return of a static production HMAC fallback value.
  if (
    /return\s+["']production-wheel-phone-attempt-hmac-fallback["']/.test(source) ||
    /=\s*["']production-wheel-phone-attempt-hmac-fallback["']/.test(source)
  ) {
    throw new Error("Hardcoded production wheel HMAC fallback must not exist");
  }
}
