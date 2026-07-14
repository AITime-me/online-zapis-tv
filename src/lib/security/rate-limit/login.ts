/**
 * @deprecated Credentials-login использует DB-backed throttle в @/lib/security/login-throttle.
 * Этот модуль сохранён для обратной совместимости экспортов; in-memory store не применяется к входу.
 */
import {
  buildAccountLoginThrottleKeyHash,
  clearLoginThrottleEntry,
  isLoginThrottleBlocked,
  normalizeLoginEmail,
  recordLoginThrottleFailure,
  defaultAccountThrottleConfig,
} from "@/lib/security/login-throttle";
import type { LoginThrottlePrisma } from "@/lib/security/login-throttle";

type HeaderLike = {
  get(name: string): string | null;
};

async function resolveLoginThrottleDb(): Promise<LoginThrottlePrisma> {
  const { prisma } = await import("@/lib/db");
  return prisma as unknown as LoginThrottlePrisma;
}

export async function isLoginRateLimited(
  normalizedEmail: string,
  headers: HeaderLike,
): Promise<boolean> {
  void headers;
  const db = await resolveLoginThrottleDb();
  const keyHash = buildAccountLoginThrottleKeyHash(normalizeLoginEmail(normalizedEmail));
  const config = defaultAccountThrottleConfig(keyHash);
  return isLoginThrottleBlocked(db, config);
}

export async function recordLoginRateLimitFailure(
  normalizedEmail: string,
  headers: HeaderLike,
): Promise<void> {
  void headers;
  const db = await resolveLoginThrottleDb();
  const keyHash = buildAccountLoginThrottleKeyHash(normalizeLoginEmail(normalizedEmail));
  const config = defaultAccountThrottleConfig(keyHash);
  await recordLoginThrottleFailure(db, config);
}

export async function resetLoginRateLimitState(
  normalizedEmail: string,
  headers: HeaderLike,
): Promise<void> {
  void headers;
  const db = await resolveLoginThrottleDb();
  const keyHash = buildAccountLoginThrottleKeyHash(normalizeLoginEmail(normalizedEmail));
  await clearLoginThrottleEntry(db, {
    scope: "ACCOUNT",
    keyHash,
  });
}
