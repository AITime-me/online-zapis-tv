import { hashLoginThrottleIdentity } from "./hmac-secret";

export function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function buildAccountLoginThrottleKeyHash(normalizedEmail: string): string {
  return hashLoginThrottleIdentity(["login-account", normalizedEmail]);
}

export function buildIpLoginThrottleKeyHash(clientIp: string): string {
  return hashLoginThrottleIdentity(["login-ip", clientIp]);
}
