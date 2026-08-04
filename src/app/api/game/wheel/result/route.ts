import { NextResponse } from "next/server";
import { applyCookieOperations } from "@/lib/game/session/game-session-cookie";
import { readSessionAuthFromRequest } from "@/lib/game/session/game-session-request";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import {
  getWheelPublicResult,
  WheelPublicGameError,
} from "@/services/WheelPublicGameService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function handleWheelError(scope: string, error: unknown) {
  if (error instanceof WheelPublicGameError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: error.code,
        ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      },
      { status: error.status },
    );
  }
  console.error(scope, error);
  return NextResponse.json(
    { ok: false, error: "Внутренняя ошибка", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const url = new URL(request.url);
    const catalogSlug = url.searchParams.get("catalogSlug") ?? "";
    const auth = readSessionAuthFromRequest(request, catalogSlug);
    const result = await getWheelPublicResult({ catalogSlug, auth });

    const response = NextResponse.json({
      ok: true,
      status: result.status,
      expiresAt: result.expiresAt,
      hasResult: result.hasResult,
      bookingSubmitted: result.bookingSubmitted,
      animation: result.animation,
      prizeDisplayName: result.prizeDisplayName,
    });
    applyCookieOperations(response, result.cookieOperations);
    return response;
  } catch (error) {
    return handleWheelError("[GET /api/game/wheel/result]", error);
  }
}
