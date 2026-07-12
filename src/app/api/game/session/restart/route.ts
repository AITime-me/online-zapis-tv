import { NextResponse } from "next/server";
import { applyCookieOperations } from "@/lib/game/session/game-session-cookie";
import { validateSessionRestartBody } from "@/lib/game/session/game-session-contract";
import { handleGameSessionRouteError } from "@/lib/game/session/game-session-http";
import { readSessionAuthFromRequest } from "@/lib/game/session/game-session-request";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { restartGameSession } from "@/services/GameSessionService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return originResponse;
  }

  try {
    const body = (await request.json()) as unknown;
    const validation = validateSessionRestartBody(body);
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: validation.error,
          code: "GAME_INVALID_REQUEST",
        },
        { status: 400 },
      );
    }

    const auth = readSessionAuthFromRequest(request, validation.catalogSlug);
    const result = await restartGameSession(validation.catalogSlug, auth);

    const response = NextResponse.json({
      ok: true,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      hasResult: result.hasResult,
      mechanicType: result.mechanicType,
    });

    applyCookieOperations(response, result.cookieOperations);
    return response;
  } catch (error) {
    return handleGameSessionRouteError("[POST /api/game/session/restart]", error);
  }
}
