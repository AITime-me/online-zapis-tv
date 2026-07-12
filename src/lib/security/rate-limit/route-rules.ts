import type { RateLimitPolicyId } from "./types";

export type ApiRateLimitRouteRule = {
  policyId: RateLimitPolicyId;
  match: (pathname: string, method: string) => boolean;
};

const AVAILABILITY_CATALOG_PREFIXES = [
  "/api/booking/available-days",
  "/api/booking/slots",
  "/api/booking/catalog",
  "/api/booking/services",
  "/api/booking/masters",
  "/api/promotions/active",
  "/api/settings/public",
] as const;

function exactPath(pathname: string, expected: string): boolean {
  return pathname === expected;
}

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

export const API_RATE_LIMIT_RULES: ApiRateLimitRouteRule[] = [
  {
    policyId: "health",
    match: (pathname, method) =>
      method === "GET" && exactPath(pathname, "/api/health"),
  },
  {
    policyId: "bookingCreate",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/booking/create"),
  },
  {
    policyId: "bookingRequest",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/booking/request"),
  },
  {
    policyId: "bookingClientContext",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/booking/client-context"),
  },
  {
    policyId: "gamePlay",
    match: (pathname, method) =>
      method === "POST" &&
      (exactPath(pathname, "/api/game/play") ||
        exactPath(pathname, "/api/game/session/start") ||
        exactPath(pathname, "/api/game/session/complete")),
  },
  {
    policyId: "gameSessionRead",
    match: (pathname, method) =>
      method === "GET" && exactPath(pathname, "/api/game/session/result"),
  },
  {
    policyId: "availabilityCatalog",
    match: (pathname, method) =>
      method === "GET" && startsWithAny(pathname, AVAILABILITY_CATALOG_PREFIXES),
  },
];

export function resolveApiRateLimitPolicy(
  pathname: string,
  method: string,
): RateLimitPolicyId | null {
  for (const rule of API_RATE_LIMIT_RULES) {
    if (rule.match(pathname, method)) {
      return rule.policyId;
    }
  }

  return null;
}

export const RATE_LIMITED_API_PATHS = API_RATE_LIMIT_RULES.flatMap((rule) => {
  switch (rule.policyId) {
    case "health":
      return [{ method: "GET", pathname: "/api/health" }];
    case "bookingCreate":
      return [{ method: "POST", pathname: "/api/booking/create" }];
    case "bookingRequest":
      return [{ method: "POST", pathname: "/api/booking/request" }];
    case "bookingClientContext":
      return [{ method: "POST", pathname: "/api/booking/client-context" }];
    case "gamePlay":
      return [
        { method: "POST", pathname: "/api/game/play" },
        { method: "POST", pathname: "/api/game/session/start" },
        { method: "POST", pathname: "/api/game/session/complete" },
      ];
    case "gameSessionRead":
      return [{ method: "GET", pathname: "/api/game/session/result" }];
    case "availabilityCatalog":
      return AVAILABILITY_CATALOG_PREFIXES.map((pathname) => ({
        method: "GET",
        pathname,
      }));
    default:
      return [];
  }
});
