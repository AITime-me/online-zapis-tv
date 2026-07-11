import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessAdminPath, canAccessInternalZone } from "@/lib/auth/permissions";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";

const OPERATIONAL_ADMIN_ROLES = new Set(["OWNER", "MANAGER"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user;
  const role = req.auth?.user?.role;

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
  matcher: ["/schedule/:path*", "/admin/:path*", "/login", "/view/schedule"],
};
