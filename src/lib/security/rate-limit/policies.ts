import type { RateLimitPolicy, RateLimitPolicyId } from "./types";

/**
 * Консервативные лимиты для single-instance staging.
 * In-memory store не распределяется между несколькими контейнерами —
 * для multi-instance нужен Redis/shared store и rate limit на reverse proxy.
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
  health: {
    id: "health",
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
};

export function getRateLimitPolicy(id: RateLimitPolicyId): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[id];
}
