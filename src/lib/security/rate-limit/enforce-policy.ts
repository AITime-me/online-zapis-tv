/**
 * Node.js server-only entry point for route handler rate limiting.
 */
import { NextResponse } from "next/server";
import { enforceRateLimitFromRequest } from "./check";
import { resolveApiRateLimitPolicy } from "./route-rules";
import type { RateLimitPolicyId } from "./types";

/**
 * Isolated wheel E2E runs ~12 gamePlay POSTs from one loopback IP within
 * the 10-minute gamePlay window (max 5). Ordinary production never sets
 * WHEEL_E2E_ISOLATED=1 — same gate as AUTH_URL loopback bypass.
 */
export function shouldBypassRateLimitForIsolatedWheelE2e(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.WHEEL_E2E_ISOLATED === "1";
}

export function enforceEndpointRateLimit(
  request: Request,
  policyId: RateLimitPolicyId,
  extraIdentityParts: string[] = [],
): NextResponse | null {
  if (shouldBypassRateLimitForIsolatedWheelE2e()) {
    return null;
  }
  return enforceRateLimitFromRequest(request, policyId, extraIdentityParts);
}

export function enforceRequestRateLimit(
  request: Request,
  extraIdentityParts: string[] = [],
): NextResponse | null {
  if (shouldBypassRateLimitForIsolatedWheelE2e()) {
    return null;
  }

  const { pathname } = new URL(request.url);
  const policyId = resolveApiRateLimitPolicy(pathname, request.method);
  if (!policyId) {
    return null;
  }

  return enforceEndpointRateLimit(request, policyId, extraIdentityParts);
}
