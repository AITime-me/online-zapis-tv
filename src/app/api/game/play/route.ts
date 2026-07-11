import { NextResponse } from "next/server";
import {
  validateGamePlayBody,
  type GamePlayRequestBody,
} from "@/lib/game/play-contract";
import {
  GamePlayGiftPoolEmptyError,
  GamePlayUnavailableError,
} from "@/lib/game/game-play-errors";
import { createGamePlayAndSelectGift } from "@/services/GamePlayService";
import { safeLogError } from "@/lib/logging/redact";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = (await request.json()) as GamePlayRequestBody;
    const validation = validateGamePlayBody(body);

    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, error: validation.error },
        { status: 400 },
      );
    }

    const { playId, gift } = await createGamePlayAndSelectGift(validation.data);

    return NextResponse.json({ ok: true, playId, gift });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Некорректный JSON в теле запроса" },
        { status: 400 },
      );
    }

    if (
      error instanceof GamePlayUnavailableError ||
      error instanceof GamePlayGiftPoolEmptyError
    ) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    safeLogError("[POST /api/game/play]", error);
    return NextResponse.json(
      { ok: false, error: "Не удалось обработать результат игры" },
      { status: 500 },
    );
  }
}
