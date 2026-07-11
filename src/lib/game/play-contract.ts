/** Машинные ключи направления из внешней игры «Поймай своё время». */
export const GAME_DIRECTIONS = [
  "faceCare",
  "faceMassage",
  "recovery",
  "toneCare",
] as const;

export type GameDirection = (typeof GAME_DIRECTIONS)[number];

export type GamePlayRequestBody = {
  gameDirection?: unknown;
  skinNeed?: unknown;
  resultType?: unknown;
  premiumLevel?: unknown;
  catalogSlug?: unknown;
  giftId?: unknown;
};

export type ValidatedGamePlayInput = {
  gameDirection: GameDirection;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
  catalogSlug: string | null;
};

const GAME_DIRECTION_SET = new Set<string>(GAME_DIRECTIONS);

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPremiumLevel(value: unknown): number | null {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

function readOptionalCatalogSlug(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const slug = readNonEmptyString(value);
  return slug ?? null;
}

export function validateGamePlayBody(
  body: GamePlayRequestBody,
): { ok: true; data: ValidatedGamePlayInput } | { ok: false; error: string } {
  if (body.giftId !== undefined && body.giftId !== null) {
    return { ok: false, error: "giftId не поддерживается" };
  }

  const gameDirectionRaw = readNonEmptyString(body.gameDirection);
  if (!gameDirectionRaw) {
    return { ok: false, error: "gameDirection обязателен" };
  }
  if (!GAME_DIRECTION_SET.has(gameDirectionRaw)) {
    return {
      ok: false,
      error: `gameDirection должен быть одним из: ${GAME_DIRECTIONS.join(", ")}`,
    };
  }

  const skinNeed = readNonEmptyString(body.skinNeed);
  if (!skinNeed) {
    return { ok: false, error: "skinNeed обязателен" };
  }

  const resultType = readNonEmptyString(body.resultType);
  if (!resultType) {
    return { ok: false, error: "resultType обязателен" };
  }

  const premiumLevel = readPremiumLevel(body.premiumLevel);
  if (premiumLevel === null) {
    return { ok: false, error: "premiumLevel должен быть числом" };
  }

  const catalogSlug = readOptionalCatalogSlug(body.catalogSlug);
  if (body.catalogSlug !== undefined && body.catalogSlug !== null && !catalogSlug) {
    return { ok: false, error: "catalogSlug должен быть непустой строкой" };
  }

  return {
    ok: true,
    data: {
      gameDirection: gameDirectionRaw as GameDirection,
      skinNeed,
      resultType,
      premiumLevel,
      catalogSlug,
    },
  };
}
