import type { RateLimitPolicyId } from "./types";
import { buildEndpointRateLimitKey } from "./client-identity";
import { getRateLimitPolicy } from "./policies";
import { createRateLimitResponse } from "./response";
import { consumeRateLimit } from "./store";

type HeaderLike = {
  get(name: string): string | null;
};

export function checkRateLimitByPolicy(
  policyId: RateLimitPolicyId,
  headers: HeaderLike,
  extraIdentityParts: string[] = [],
) {
  const policy = getRateLimitPolicy(policyId);
  const key = buildEndpointRateLimitKey(policyId, headers, extraIdentityParts);
  return consumeRateLimit(key, policy.windowMs, policy.maxRequests);
}

export function enforceRateLimitFromHeaders(
  policyId: RateLimitPolicyId,
  headers: HeaderLike,
  extraIdentityParts: string[] = [],
) {
  const decision = checkRateLimitByPolicy(policyId, headers, extraIdentityParts);

  if (!decision.allowed) {
    return createRateLimitResponse(decision.retryAfterSeconds);
  }

  return null;
}

export function enforceRateLimitFromRequest(
  request: Request,
  policyId: RateLimitPolicyId,
  extraIdentityParts: string[] = [],
) {
  return enforceRateLimitFromHeaders(policyId, request.headers, extraIdentityParts);
}
