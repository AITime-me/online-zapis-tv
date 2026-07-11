export const PUBLIC_MUTATING_API_PATHS = new Set([
  "/api/booking/create",
  "/api/booking/request",
  "/api/booking/client-context",
  "/api/game/play",
  "/api/booking/manage/cancel",
  "/api/booking/manage/reschedule-request",
]);

export function isMutatingMethod(method: string): boolean {
  return (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

export function requiresAdminCsrfProtection(
  pathname: string,
  method: string,
): boolean {
  if (!isMutatingMethod(method)) {
    return false;
  }

  if (pathname.startsWith("/api/auth/")) {
    return false;
  }

  if (PUBLIC_MUTATING_API_PATHS.has(pathname)) {
    return false;
  }

  return pathname.startsWith("/api/");
}

/**
 * Converts a Next.js app route file path to an API pathname.
 * Example: src/app/api/admin/users/route.ts -> /api/admin/users
 */
export function apiPathnameFromRouteFile(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = normalized.match(/src\/app\/api\/(.+)\/route\.ts$/);
  if (!match) {
    return "";
  }

  const segments = match[1]
    .split("/")
    .filter((segment) => !segment.startsWith("[") && !segment.startsWith("("));

  return `/api/${segments.join("/")}`;
}

export function isDynamicApiRouteFile(relativePath: string): boolean {
  return /\/\[[^/]+\]\//.test(relativePath.replace(/\\/g, "/"));
}

export const PROTECTED_MUTATING_ROUTE_GUARD =
  /requireProtectedMutatingApi\s*\(|requireProtectedInternalMutatingApi\s*\(/;

export const MUTATING_HANDLER_PATTERN =
  /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/g;
