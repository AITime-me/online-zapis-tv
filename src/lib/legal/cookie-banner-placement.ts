export const WHEEL_COOKIE_BANNER_OFFSET_VAR = "--wheel-cookie-banner-offset";

export function shouldShowCookieBanner(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return false;
  if (pathname.startsWith("/schedule")) return false;
  if (pathname.startsWith("/view/")) return false;
  if (pathname === "/login") return false;
  return true;
}

/** Promo Wheel CTA sits at the bottom; reserve space so the fixed banner cannot cover it. */
export function promoPathNeedsCookieBannerOffset(pathname: string): boolean {
  return pathname.startsWith("/promo");
}
