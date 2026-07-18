import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/middleware-auth";
import { canAccessAdminPath, canAccessInternalZone } from "@/lib/auth/permissions";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";
import {
  createCsrfForbiddenResponse,
  hasSessionAuthCookie,
  validateSameOriginRequest,
} from "@/lib/security/csrf";
import {
  requiresAdminCsrfProtection,
} from "@/lib/security/csrf-route-rules";
import {
  buildManageSessionCookieOptions,
  isPlausibleManageBearerToken,
  MANAGE_SESSION_COOKIE,
  shouldUseSecureManageCookie,
} from "@/lib/booking/manage-session-cookie";

const OPERATIONAL_ADMIN_ROLES = new Set(["OWNER", "MANAGER"]);

const MANAGE_PAGE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

function applyManagePageSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", MANAGE_PAGE_CACHE_CONTROL);
  response.headers.set("Pragma", "no-cache");
  // Prevent Next from treating the document as a long-lived full-route cache entry.
  response.headers.set("CDN-Cache-Control", MANAGE_PAGE_CACHE_CONTROL);
  response.headers.set("Vercel-CDN-Cache-Control", MANAGE_PAGE_CACHE_CONTROL);
  return response;
}

function handleManagePage(req: NextRequest): NextResponse {
  const rawBearer = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  const hasTokenQuery = req.nextUrl.searchParams.has("token");

  // Always strip ?token= from the visible URL when present (even if malformed),
  // so RSC/HTML flight never embeds the query secret.
  if (hasTokenQuery) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.searchParams.delete("token");
    const redirect = NextResponse.redirect(cleanUrl, 303);

    if (isPlausibleManageBearerToken(rawBearer)) {
      redirect.cookies.set(
        MANAGE_SESSION_COOKIE,
        rawBearer,
        buildManageSessionCookieOptions(
          shouldUseSecureManageCookie({
            protocol: req.nextUrl.protocol,
            hostname: req.nextUrl.hostname,
            forwardedProto: req.headers.get("x-forwarded-proto"),
          }),
        ),
      );
    }

    return applyManagePageSecurityHeaders(redirect);
  }

  const response = NextResponse.next();
  return applyManagePageSecurityHeaders(response);
}

function handleApiCsrf(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  const method = req.method;

  if (
    requiresAdminCsrfProtection(pathname, method) &&
    hasSessionAuthCookie(req.cookies)
  ) {
    if (!validateSameOriginRequest(req)) {
      return createCsrfForbiddenResponse();
    }
  }

  return null;
}

/**
 * Auth.js wrapper can interfere with final document Cache-Control.
 * Keep public manage-link outside auth() so no-store headers stick.
 */
const withAuth = auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    const csrfResponse = handleApiCsrf(req);
    if (csrfResponse) {
      return csrfResponse;
    }

    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth?.user;
  const role = req.auth?.user?.role;

  if (pathname === "/reset-password") {
    const response = NextResponse.next();
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (pathname.startsWith("/view/schedule")) {
    const token = req.nextUrl.searchParams.get("token");
    if (!isValidScheduleViewToken(token)) {
      return new NextResponse("Неверная или отсутствующая ссылка", {
        status: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  if (pathname.startsWith("/schedule")) {
    if (!isLoggedIn || !role || !canAccessInternalZone(role)) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn || !role) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (!OPERATIONAL_ADMIN_ROLES.has(role)) {
      return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
    }

    if (!canAccessAdminPath(role, pathname)) {
      return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
    }
  }

  if (pathname === "/login" && isLoggedIn && role && canAccessInternalZone(role)) {
    return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export default function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/booking/manage")) {
    return handleManagePage(req);
  }

  // Auth.js middleware accepts the request; event typing differs across versions.
  return (withAuth as (request: NextRequest) => ReturnType<typeof handleManagePage>)(req);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/schedule/:path*",
    "/admin/:path*",
    "/login",
    "/reset-password",
    "/view/schedule",
    "/booking/manage",
  ],
};
