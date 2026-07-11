import { buildLoginRateLimitKey } from "./client-identity";
import { getRateLimitPolicy } from "./policies";
import {
  clearRateLimitEntry,
  isRateLimitFailureBlocked,
  recordRateLimitFailure,
} from "./store";

type HeaderLike = {
  get(name: string): string | null;
};

export function isLoginRateLimited(
  normalizedEmail: string,
  headers: HeaderLike,
): boolean {
  const policy = getRateLimitPolicy("login");
  const key = buildLoginRateLimitKey(normalizedEmail, headers);
  const maxFailures = policy.maxFailures ?? policy.maxRequests;

  return !isRateLimitFailureBlocked(key, maxFailures).allowed;
}

export function recordLoginRateLimitFailure(
  normalizedEmail: string,
  headers: HeaderLike,
): void {
  const policy = getRateLimitPolicy("login");
  const key = buildLoginRateLimitKey(normalizedEmail, headers);
  const maxFailures = policy.maxFailures ?? policy.maxRequests;

  recordRateLimitFailure(key, policy.windowMs, maxFailures);
}

export function resetLoginRateLimitState(
  normalizedEmail: string,
  headers: HeaderLike,
): void {
  const key = buildLoginRateLimitKey(normalizedEmail, headers);
  clearRateLimitEntry(key);
}
