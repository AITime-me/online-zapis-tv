import { NextResponse } from "next/server";
import { applyCookieOperations } from "@/lib/game/session/game-session-cookie";
import {
  validateSessionCompleteBody,
  type GameSessionCompleteBody,
} from "@/lib/game/session/game-session-contract";
import { handleGameSessionRouteError } from "@/lib/game/session/game-session-http";
import { readSessionAuthFromRequest } from "@/lib/game/session/game-session-request";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { completeGameSession } from "@/services/GameSessionService";

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
    const body = (await request.json()) as GameSessionCompleteBody;
    const validation = validateSessionCompleteBody(body);
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

    const auth = readSessionAuthFromRequest(request, validation.data.catalogSlug);
    const result = await completeGameSession({
      catalogSlug: validation.data.catalogSlug,
      auth,
      gameDirection: validation.data.gameDirection,
      skinNeed: validation.data.skinNeed,
      resultType: validation.data.resultType,
      premiumLevel: validation.data.premiumLevel,
      clientMetrics: validation.data.clientMetrics,
    });

    const response = NextResponse.json({
      ok: true,
      gamePlayId: result.gamePlayId,
      gift: result.gift,
      bookingExpiresAt: result.bookingExpiresAt.toISOString(),
    });

    applyCookieOperations(response, result.cookieOperations);
    return response;
  } catch (error) {
    return handleGameSessionRouteError("[POST /api/game/session/complete]", error);
  }
}
