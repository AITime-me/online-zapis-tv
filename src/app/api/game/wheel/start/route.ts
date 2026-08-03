import { NextResponse } from "next/server";
import { applyCookieOperations } from "@/lib/game/session/game-session-cookie";
import { readSessionAuthFromRequest } from "@/lib/game/session/game-session-request";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import {
  startWheelPublicGame,
  WheelPublicGameError,
} from "@/services/WheelPublicGameService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function handleWheelError(scope: string, error: unknown) {
  if (error instanceof WheelPublicGameError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(scope, error);
  return NextResponse.json(
    { ok: false, error: "Внутренняя ошибка", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

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
    const body = (await request.json()) as Record<string, unknown>;
    const catalogSlug =
      typeof body.catalogSlug === "string" ? body.catalogSlug : "";
    const auth = readSessionAuthFromRequest(request, catalogSlug);
    const result = await startWheelPublicGame({
      catalogSlug,
      name: typeof body.name === "string" ? body.name : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      personalDataConsent: body.personalDataConsent === true,
      offerAcknowledgement: body.offerAcknowledgement === true,
      auth,
    });

    const response = NextResponse.json({
      ok: true,
      status: result.status,
      expiresAt: result.expiresAt,
      created: result.created,
      sessionToken: result.sessionToken,
      animation: result.animation,
    });
    applyCookieOperations(response, result.cookieOperations);
    return response;
  } catch (error) {
    return handleWheelError("[POST /api/game/wheel/start]", error);
  }
}
