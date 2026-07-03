import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessInternalZone } from "@/lib/auth/permissions";

const EXPORT_ADMIN_ROLES = new Set(["OWNER", "MANAGER"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user;
  const role = req.auth?.user?.role;

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

    if (!EXPORT_ADMIN_ROLES.has(role)) {
      return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
    }
  }

  if (pathname === "/login" && isLoggedIn && role && canAccessInternalZone(role)) {
    return NextResponse.redirect(new URL("/schedule", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/schedule/:path*", "/admin/:path*", "/login"],
};
