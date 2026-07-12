import { NextResponse } from "next/server";
import {
  GameSessionError,
  isGameSessionError,
} from "@/lib/game/session/game-session-errors";
import { safeLogError } from "@/lib/logging/redact";

export function gameSessionErrorResponse(error: GameSessionError): NextResponse {
  return NextResponse.json(
    {
      ok: false as const,
      error: error.message,
      code: error.code,
    },
    { status: error.httpStatus },
  );
}

export function handleGameSessionRouteError(
  scope: string,
  error: unknown,
): NextResponse {
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, error: "Некорректный JSON в теле запроса", code: "GAME_INVALID_REQUEST" },
      { status: 400 },
    );
  }

  if (isGameSessionError(error)) {
    return gameSessionErrorResponse(error);
  }

  safeLogError(scope, error);
  return NextResponse.json(
    {
      ok: false,
      error: "Не удалось обработать игровой запрос",
      code: "GAME_RESULT_UNAVAILABLE",
    },
    { status: 500 },
  );
}
