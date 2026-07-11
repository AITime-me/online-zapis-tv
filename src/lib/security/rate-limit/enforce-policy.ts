/**
 * Node.js server-only entry point for route handler rate limiting.
 */
import { NextResponse } from "next/server";
import { enforceRateLimitFromRequest } from "./check";
import { resolveApiRateLimitPolicy } from "./route-rules";
import type { RateLimitPolicyId } from "./types";

export function enforceEndpointRateLimit(
  request: Request,
  policyId: RateLimitPolicyId,
  extraIdentityParts: string[] = [],
): NextResponse | null {
  return enforceRateLimitFromRequest(request, policyId, extraIdentityParts);
}

export function enforceRequestRateLimit(
  request: Request,
  extraIdentityParts: string[] = [],
): NextResponse | null {
  const { pathname } = new URL(request.url);
  const policyId = resolveApiRateLimitPolicy(pathname, request.method);
  if (!policyId) {
    return null;
  }

  return enforceEndpointRateLimit(request, policyId, extraIdentityParts);
}
