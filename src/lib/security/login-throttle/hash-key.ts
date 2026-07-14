import { hashRateLimitIdentity } from "@/lib/security/rate-limit/hash-key";

export function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function buildAccountLoginThrottleKeyHash(normalizedEmail: string): string {
  return hashRateLimitIdentity(["login-account", normalizedEmail]);
}

export function buildIpLoginThrottleKeyHash(clientIp: string): string {
  return hashRateLimitIdentity(["login-ip", clientIp]);
}
