import "server-only";

import type { SessionAuthContext } from "@/lib/game/session/game-session-contract";
import {
  buildCatalogSessionCookieName,
  GAME_VISITOR_COOKIE,
  readRequestCookie,
} from "@/lib/game/session/game-session-cookie";

export function readSessionAuthFromRequest(
  request: Request,
  catalogSlug: string,
): SessionAuthContext {
  const cookieHeader = request.headers.get("cookie");
  const sessionCookieName = buildCatalogSessionCookieName(catalogSlug);

  return {
    visitorToken: readRequestCookie(cookieHeader, GAME_VISITOR_COOKIE),
    sessionToken: readRequestCookie(cookieHeader, sessionCookieName),
  };
}
