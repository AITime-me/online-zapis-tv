export const GAME_SESSION_ERROR_CODES = [
  "GAME_UNAVAILABLE",
  "GAME_SESSION_EXPIRED",
  "GAME_SESSION_NOT_FOUND",
  "GAME_SESSION_LIMIT",
  "GAME_RESULT_UNAVAILABLE",
  "GAME_MECHANIC_UNSUPPORTED",
  "GAME_INVALID_REQUEST",
] as const;

export type GameSessionErrorCode = (typeof GAME_SESSION_ERROR_CODES)[number];

const ERROR_HTTP_STATUS: Record<GameSessionErrorCode, number> = {
  GAME_UNAVAILABLE: 400,
  GAME_SESSION_EXPIRED: 400,
  GAME_SESSION_NOT_FOUND: 404,
  GAME_SESSION_LIMIT: 429,
  GAME_RESULT_UNAVAILABLE: 400,
  GAME_MECHANIC_UNSUPPORTED: 400,
  GAME_INVALID_REQUEST: 400,
};

export class GameSessionError extends Error {
  readonly code: GameSessionErrorCode;
  readonly httpStatus: number;

  constructor(code: GameSessionErrorCode, message: string) {
    super(message);
    this.name = "GameSessionError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}

export function isGameSessionError(error: unknown): error is GameSessionError {
  return error instanceof GameSessionError;
}
