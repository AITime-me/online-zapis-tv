import type { RateLimitPolicy, RateLimitPolicyId } from "./types";

/**
 * Консервативные лимиты для single-instance staging/production app process.
 * In-memory store не распределяется между несколькими контейнерами/воркерами.
 * SECURITY INVARIANT: app topology must remain single-instance (compose guard).
 * Перед горизонтальным масштабированием обязателен shared limiter (Redis/proxy).
 */
export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyId, RateLimitPolicy> = {
  login: {
    id: "login",
    windowMs: 15 * 60 * 1000,
    maxRequests: 20,
    /** Устаревшая справочная запись: фактический лимит — DB-backed login-throttle (5/account). */
    maxFailures: 5,
  },
  bookingCreate: {
    id: "bookingCreate",
    windowMs: 15 * 60 * 1000,
    maxRequests: 12,
  },
  bookingRequest: {
    id: "bookingRequest",
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
  },
  problemReport: {
    id: "problemReport",
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  },
  bookingClientContext: {
    id: "bookingClientContext",
    windowMs: 10 * 60 * 1000,
    maxRequests: 30,
  },
  bookingManage: {
    id: "bookingManage",
    windowMs: 15 * 60 * 1000,
    maxRequests: 40,
  },
  gamePlay: {
    id: "gamePlay",
    windowMs: 10 * 60 * 1000,
    maxRequests: 5,
  },
  gameSessionRead: {
    id: "gameSessionRead",
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  availabilityCatalog: {
    id: "availabilityCatalog",
    windowMs: 60 * 1000,
    maxRequests: 120,
  },
  /**
   * Authenticated S2S bot internal API (Bearer).
   * Separate bucket from public browser catalog/booking limits.
   */
  botInternal: {
    id: "botInternal",
    windowMs: 60 * 1000,
    maxRequests: 120,
  },
  /**
   * Authenticated S2S bot confirmed booking create (CURSOR-24).
   * Stricter than shared botInternal read bucket.
   */
  botInternalBookingCreate: {
    id: "botInternalBookingCreate",
    windowMs: 15 * 60 * 1000,
    maxRequests: 30,
  },
  health: {
    id: "health",
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
  /**
   * Forgot-password: IP/fingerprint flood guard.
   * Stricter than bookingCreate — email side-effects are costly.
   * Per-user 60s cooldown remains in PasswordResetService.
   */
  passwordResetRequest: {
    id: "passwordResetRequest",
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  },
};

export function getRateLimitPolicy(id: RateLimitPolicyId): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[id];
}
