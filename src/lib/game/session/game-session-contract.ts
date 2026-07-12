import {
  GAME_DIRECTIONS,
  type GameDirection,
} from "@/lib/game/play-contract";
import { GAME_SLUG_PATTERN, normalizeGameSlug } from "@/lib/games/catalog-contract";

export type SessionAuthContext = {
  visitorToken: string | null;
  sessionToken: string | null;
};

export type GameMechanicTypeDto = "CATCH_TIME" | "WHEEL_OF_FORTUNE";

export type GameSessionStatusDto =
  | "ACTIVE"
  | "COMPLETED"
  | "CONSUMED"
  | "EXPIRED";

export type PublicGameGiftDto = {
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
};

export type GameSessionStartResponse = {
  ok: true;
  status: "ACTIVE" | "COMPLETED";
  expiresAt: string;
  hasResult: boolean;
  mechanicType: GameMechanicTypeDto;
};

export type GameSessionCompleteResponse = {
  ok: true;
  gamePlayId: string;
  gift: PublicGameGiftDto;
  bookingExpiresAt: string;
};

export type GameSessionResultResponse = {
  ok: true;
  status: "ACTIVE" | "COMPLETED" | "CONSUMED";
  hasResult: boolean;
  gamePlayId?: string;
  gift?: PublicGameGiftDto;
  bookingExpiresAt?: string;
};

export type GameSessionClientMetrics = {
  score?: number;
  catches?: number;
  durationMs?: number;
};

export type GameSessionCompleteBody = {
  catalogSlug?: unknown;
  gameDirection?: unknown;
  skinNeed?: unknown;
  resultType?: unknown;
  premiumLevel?: unknown;
  giftId?: unknown;
  clientMetrics?: unknown;
};

const GAME_DIRECTION_SET = new Set<string>(GAME_DIRECTIONS);
const MAX_STRING_LENGTH = 200;
const MAX_METRICS_JSON_LENGTH = 2048;

function readNonEmptyString(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function readCatalogSlug(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const slug = readNonEmptyString(value, 120);
  if (!slug) {
    return null;
  }
  const normalized = normalizeGameSlug(slug);
  if (!normalized || !GAME_SLUG_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
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

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readFiniteInteger(value: unknown): number | null {
  const number = readFiniteNumber(value);
  if (number === null) {
    return null;
  }
  return Math.trunc(number);
}

export function validateSessionStartBody(
  body: unknown,
): { ok: true; catalogSlug: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "catalogSlug обязателен" };
  }

  const catalogSlug = readCatalogSlug((body as { catalogSlug?: unknown }).catalogSlug);
  if (!catalogSlug) {
    return { ok: false, error: "catalogSlug обязателен" };
  }

  return { ok: true, catalogSlug };
}

export function validateSessionCompleteBody(
  body: GameSessionCompleteBody,
): {
  ok: true;
  data: {
    catalogSlug: string;
    gameDirection: GameDirection;
    skinNeed: string;
    resultType: string;
    premiumLevel: number;
    clientMetrics: GameSessionClientMetrics | null;
  };
} | { ok: false; error: string } {
  if (body.giftId !== undefined && body.giftId !== null) {
    return { ok: false, error: "giftId не поддерживается" };
  }

  const catalogSlug = readCatalogSlug(body.catalogSlug);
  if (!catalogSlug) {
    return { ok: false, error: "catalogSlug обязателен" };
  }

  const gameDirectionRaw = readNonEmptyString(body.gameDirection);
  if (!gameDirectionRaw || !GAME_DIRECTION_SET.has(gameDirectionRaw)) {
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

  let clientMetrics: GameSessionClientMetrics | null = null;
  if (body.clientMetrics !== undefined && body.clientMetrics !== null) {
    if (typeof body.clientMetrics !== "object" || Array.isArray(body.clientMetrics)) {
      return { ok: false, error: "clientMetrics должен быть объектом" };
    }

    const metricsJson = JSON.stringify(body.clientMetrics);
    if (metricsJson.length > MAX_METRICS_JSON_LENGTH) {
      return { ok: false, error: "clientMetrics слишком большой" };
    }

    const raw = body.clientMetrics as Record<string, unknown>;
    const score = raw.score === undefined ? undefined : readFiniteNumber(raw.score);
    const catches = raw.catches === undefined ? undefined : readFiniteInteger(raw.catches);
    const durationMs =
      raw.durationMs === undefined ? undefined : readFiniteInteger(raw.durationMs);

    if (raw.score !== undefined && score === null) {
      return { ok: false, error: "clientMetrics.score должен быть числом" };
    }
    if (raw.catches !== undefined && catches === null) {
      return { ok: false, error: "clientMetrics.catches должен быть целым числом" };
    }
    if (raw.durationMs !== undefined && durationMs === null) {
      return { ok: false, error: "clientMetrics.durationMs должен быть целым числом" };
    }

    clientMetrics = {
      ...(score !== undefined && score !== null ? { score } : {}),
      ...(catches !== undefined && catches !== null ? { catches } : {}),
      ...(durationMs !== undefined && durationMs !== null ? { durationMs } : {}),
    };
  }

  return {
    ok: true,
    data: {
      catalogSlug,
      gameDirection: gameDirectionRaw as GameDirection,
      skinNeed,
      resultType,
      premiumLevel,
      clientMetrics,
    },
  };
}

export function validateSessionResultQuery(
  catalogSlugRaw: string | null,
): { ok: true; catalogSlug: string } | { ok: false; error: string } {
  const catalogSlug = readCatalogSlug(catalogSlugRaw ?? undefined);
  if (!catalogSlug) {
    return { ok: false, error: "catalogSlug обязателен" };
  }
  return { ok: true, catalogSlug };
}
