export type RateLimitPolicyId =
  | "login"
  | "bookingCreate"
  | "bookingRequest"
  | "bookingClientContext"
  | "gamePlay"
  | "availabilityCatalog"
  | "health";

export type RateLimitPolicy = {
  id: RateLimitPolicyId;
  windowMs: number;
  maxRequests: number;
  /** Для login — максимум неуспешных попыток в окне. */
  maxFailures?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export type RateLimitStoreEntry = {
  count: number;
  resetAt: number;
  failureCount?: number;
};
