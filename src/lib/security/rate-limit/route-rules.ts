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
    policyId: "problemReport",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/booking/problem-report"),
  },
  {
    policyId: "bookingClientContext",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/booking/client-context"),
  },
  {
    policyId: "passwordResetRequest",
    match: (pathname, method) =>
      method === "POST" && exactPath(pathname, "/api/auth/forgot-password"),
  },
  {
    policyId: "bookingManage",
    match: (pathname, method) =>
      (method === "GET" && exactPath(pathname, "/api/booking/manage")) ||
      (method === "POST" &&
        (exactPath(pathname, "/api/booking/manage/cancel") ||
          exactPath(pathname, "/api/booking/manage/reschedule-request"))),
  },
  {
    policyId: "gamePlay",
    match: (pathname, method) =>
      method === "POST" &&
      (exactPath(pathname, "/api/game/play") ||
        exactPath(pathname, "/api/game/session/start") ||
        exactPath(pathname, "/api/game/session/restart") ||
        exactPath(pathname, "/api/game/session/complete") ||
        exactPath(pathname, "/api/game/wheel/start") ||
        exactPath(pathname, "/api/game/wheel/complete")),
  },
  {
    policyId: "gameSessionRead",
    match: (pathname, method) =>
      method === "GET" &&
      (exactPath(pathname, "/api/game/session/result") ||
        exactPath(pathname, "/api/game/wheel/result")),
  },
  {
    policyId: "availabilityCatalog",
    match: (pathname, method) =>
      method === "GET" && startsWithAny(pathname, AVAILABILITY_CATALOG_PREFIXES),
  },
  {
    policyId: "botInternalBookingCreate",
    match: (pathname, method) =>
      method === "POST" &&
      (exactPath(pathname, "/api/internal/bot/v1/bookings") ||
        exactPath(pathname, "/api/internal/bot/v1/booking-requests/book")),
  },
  {
    policyId: "botInternalMasterCommand",
    match: (pathname, method) =>
      method === "POST" &&
      pathname.startsWith("/api/internal/bot/v1/master/") &&
      !exactPath(pathname, "/api/internal/bot/v1/master/schedule"),
  },
  {
    policyId: "botInternal",
    match: (pathname, method) =>
      method === "POST" &&
      pathname.startsWith("/api/internal/bot/v1/") &&
      !exactPath(pathname, "/api/internal/bot/v1/bookings") &&
      !exactPath(pathname, "/api/internal/bot/v1/booking-requests/book") &&
      !(
        pathname.startsWith("/api/internal/bot/v1/master/") &&
        !exactPath(pathname, "/api/internal/bot/v1/master/schedule")
      ),
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
    case "problemReport":
      return [{ method: "POST", pathname: "/api/booking/problem-report" }];
    case "bookingClientContext":
      return [{ method: "POST", pathname: "/api/booking/client-context" }];
    case "passwordResetRequest":
      return [{ method: "POST", pathname: "/api/auth/forgot-password" }];
    case "bookingManage":
      return [
        { method: "GET", pathname: "/api/booking/manage" },
        { method: "POST", pathname: "/api/booking/manage/cancel" },
        { method: "POST", pathname: "/api/booking/manage/reschedule-request" },
      ];
    case "gamePlay":
      return [
        { method: "POST", pathname: "/api/game/play" },
        { method: "POST", pathname: "/api/game/session/start" },
        { method: "POST", pathname: "/api/game/session/restart" },
        { method: "POST", pathname: "/api/game/session/complete" },
        { method: "POST", pathname: "/api/game/wheel/start" },
        { method: "POST", pathname: "/api/game/wheel/complete" },
      ];
    case "gameSessionRead":
      return [
        { method: "GET", pathname: "/api/game/session/result" },
        { method: "GET", pathname: "/api/game/wheel/result" },
      ];
    case "availabilityCatalog":
      return AVAILABILITY_CATALOG_PREFIXES.map((pathname) => ({
        method: "GET",
        pathname,
      }));
    case "botInternalBookingCreate":
      return [
        { method: "POST", pathname: "/api/internal/bot/v1/bookings" },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/booking-requests/book",
        },
      ];
    case "botInternalMasterCommand":
      return [
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/master/blocks/close-interval",
        },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/master/blocks/close-day",
        },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/master/blocks/delete",
        },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/master/extra-work/create",
        },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/master/extra-work/delete",
        },
        { method: "POST", pathname: "/api/internal/bot/v1/master/bookings" },
      ];
    case "botInternal":
      return [
        { method: "POST", pathname: "/api/internal/bot/v1/eligibility" },
        { method: "POST", pathname: "/api/internal/bot/v1/available-days" },
        { method: "POST", pathname: "/api/internal/bot/v1/slots" },
        { method: "POST", pathname: "/api/internal/bot/v1/master/schedule" },
        { method: "POST", pathname: "/api/internal/bot/v1/booking-requests/feed" },
        { method: "POST", pathname: "/api/internal/bot/v1/booking-requests/get" },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/booking-requests/availability",
        },
        {
          method: "POST",
          pathname: "/api/internal/bot/v1/booking-requests/appointments-lookup",
        },
      ];
    default:
      return [];
  }
});
