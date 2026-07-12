import { NextResponse } from "next/server";
import { validateSessionResultQuery } from "@/lib/game/session/game-session-contract";
import { handleGameSessionRouteError } from "@/lib/game/session/game-session-http";
import { readSessionAuthFromRequest } from "@/lib/game/session/game-session-request";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { getGameSessionResult } from "@/services/GameSessionService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const { searchParams } = new URL(request.url);
    const validation = validateSessionResultQuery(searchParams.get("catalogSlug"));
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
    const result = await getGameSessionResult(validation.catalogSlug, auth);

    if (!result.hasResult) {
      return NextResponse.json({
        ok: true,
        status: result.status,
        hasResult: false,
      });
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      hasResult: true,
      gamePlayId: result.gamePlayId,
      gift: result.gift,
      bookingExpiresAt: result.bookingExpiresAt?.toISOString(),
    });
  } catch (error) {
    return handleGameSessionRouteError("[GET /api/game/session/result]", error);
  }
}
