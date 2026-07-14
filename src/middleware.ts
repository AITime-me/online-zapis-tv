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

const OPERATIONAL_ADMIN_ROLES = new Set(["OWNER", "MANAGER"]);

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

export default auth((req) => {
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

export const config = {
  matcher: [
    "/api/:path*",
    "/schedule/:path*",
    "/admin/:path*",
    "/login",
    "/reset-password",
    "/view/schedule",
  ],
};
