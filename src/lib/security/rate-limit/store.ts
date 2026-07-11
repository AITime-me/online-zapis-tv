import type { RateLimitDecision, RateLimitStoreEntry } from "./types";

export const MAX_RATE_LIMIT_STORE_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

type RateLimitStoreState = {
  entries: Map<string, RateLimitStoreEntry>;
  lastCleanupAt: number;
  now: () => number;
};

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStoreState: RateLimitStoreState | undefined;
}

function createStoreState(): RateLimitStoreState {
  return {
    entries: new Map<string, RateLimitStoreEntry>(),
    lastCleanupAt: 0,
    now: () => Date.now(),
  };
}

function getStoreState(): RateLimitStoreState {
  if (!globalThis.__rateLimitStoreState) {
    globalThis.__rateLimitStoreState = createStoreState();
  }
  return globalThis.__rateLimitStoreState;
}

export function resetRateLimitStoreForTests(): void {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.SECURITY_BATCH_TEST !== "1"
  ) {
    throw new Error("resetRateLimitStoreForTests доступен только в test environment");
  }
  globalThis.__rateLimitStoreState = createStoreState();
}

export function setRateLimitClockForTests(now: () => number): void {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.SECURITY_BATCH_TEST !== "1"
  ) {
    throw new Error("setRateLimitClockForTests доступен только в test environment");
  }
  getStoreState().now = now;
}

function cleanupExpiredEntries(state: RateLimitStoreState, now: number): void {
  if (now - state.lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  for (const [key, entry] of state.entries) {
    if (entry.resetAt <= now) {
      state.entries.delete(key);
    }
  }

  state.lastCleanupAt = now;
}

function evictOldestIfNeeded(state: RateLimitStoreState): void {
  while (state.entries.size > MAX_RATE_LIMIT_STORE_SIZE) {
    const oldestKey = state.entries.keys().next().value;
    if (!oldestKey) {
      break;
    }
    state.entries.delete(oldestKey);
  }
}

function toDecision(
  allowed: boolean,
  resetAt: number,
  remaining: number,
  now: number,
): RateLimitDecision {
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed,
    retryAfterSeconds,
    remaining: Math.max(0, remaining),
  };
}

export function consumeRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): RateLimitDecision {
  const state = getStoreState();
  const now = state.now();

  cleanupExpiredEntries(state, now);

  const existing = state.entries.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    state.entries.set(key, { count: 1, resetAt });
    evictOldestIfNeeded(state);
    return toDecision(true, resetAt, maxRequests - 1, now);
  }

  if (existing.count >= maxRequests) {
    return toDecision(false, existing.resetAt, 0, now);
  }

  existing.count += 1;
  state.entries.set(key, existing);
  evictOldestIfNeeded(state);

  return toDecision(true, existing.resetAt, maxRequests - existing.count, now);
}

export function recordRateLimitFailure(
  key: string,
  windowMs: number,
  maxFailures: number,
): RateLimitDecision {
  const state = getStoreState();
  const now = state.now();

  cleanupExpiredEntries(state, now);

  const existing = state.entries.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    state.entries.set(key, { count: 0, resetAt, failureCount: 1 });
    evictOldestIfNeeded(state);
    return toDecision(true, resetAt, maxFailures - 1, now);
  }

  const failureCount = (existing.failureCount ?? 0) + 1;
  existing.failureCount = failureCount;
  state.entries.set(key, existing);
  evictOldestIfNeeded(state);

  if (failureCount >= maxFailures) {
    return toDecision(false, existing.resetAt, 0, now);
  }

  return toDecision(true, existing.resetAt, maxFailures - failureCount, now);
}

export function isRateLimitFailureBlocked(
  key: string,
  maxFailures: number,
): RateLimitDecision {
  const state = getStoreState();
  const now = state.now();

  cleanupExpiredEntries(state, now);

  const existing = state.entries.get(key);
  if (!existing || existing.resetAt <= now) {
    return toDecision(true, now, maxFailures, now);
  }

  const failureCount = existing.failureCount ?? 0;
  if (failureCount >= maxFailures) {
    return toDecision(false, existing.resetAt, 0, now);
  }

  return toDecision(true, existing.resetAt, maxFailures - failureCount, now);
}

export function clearRateLimitEntry(key: string): void {
  getStoreState().entries.delete(key);
}

export function getRateLimitStoreSizeForTests(): number {
  return getStoreState().entries.size;
}
