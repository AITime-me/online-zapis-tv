import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildCatalogScopedGiftPool } from "@/lib/game/session/catalog-gift-pool";
import {
  buildCatalogSessionCookieName,
  buildSessionDeleteOperation,
  buildSessionSetOperation,
  buildVisitorSetOperation,
  CLAIM_WINDOW_MS,
  PLAY_WINDOW_MS,
  SESSION_LIMIT_WINDOW_MS,
  SESSION_START_LIMIT,
  type CookieOperation,
} from "@/lib/game/session/game-session-cookie";
import type {
  GameMechanicTypeDto,
  GameSessionClientMetrics,
  PublicGameGiftDto,
  SessionAuthContext,
} from "@/lib/game/session/game-session-contract";
import { GameSessionError } from "@/lib/game/session/game-session-errors";
import { expireGameSessionIfNeededWithDb } from "@/lib/game/session/game-session-expiration";
import {
  buildGiftSnapshot,
  buildRulesSnapshot,
  mechanicTypeFromCatalog,
  parseGiftSnapshot,
  publicGiftFromSnapshot,
  type GiftSnapshot,
} from "@/lib/game/session/game-session-snapshot";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "@/lib/game/session/game-session-token";
import { normalizeGameSlug } from "@/lib/games/catalog-contract";
import { weightedGiftPick } from "@/lib/game/weighted-gift-pick";
import { getStudioSettings } from "@/services/StudioSettingsService";

const SERVER_RESULT_TIER = 0;
const BOOKING_WINDOW_HOURS = 24;

export type { SessionAuthContext } from "@/lib/game/session/game-session-contract";

export type ResolvedGameCatalog = {
  id: string;
  slug: string;
  title: string;
  type: "CATCH_TIME" | "WHEEL_OF_FORTUNE";
  campaignKey: string | null;
  rulesVersion: string;
  legacyConfigId: string | null;
  mechanicType: GameMechanicTypeDto;
};

export type StartGameSessionResult = {
  status: "ACTIVE" | "COMPLETED";
  expiresAt: Date;
  hasResult: boolean;
  mechanicType: GameMechanicTypeDto;
  sessionToken: string;
  cookieOperations: CookieOperation[];
};

export type CompleteGameSessionInput = {
  catalogSlug: string;
  auth: SessionAuthContext;
  gameDirection: string;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
  clientMetrics: GameSessionClientMetrics | null;
  /** Adapter may pass freshly created token before browser round-trip. */
  sessionTokenOverride?: string | null;
};

export type CompleteGameSessionResult = {
  gamePlayId: string;
  gift: PublicGameGiftDto;
  bookingExpiresAt: Date;
  cookieOperations: CookieOperation[];
};

export type GameSessionResultData = {
  status: "ACTIVE" | "COMPLETED" | "CONSUMED";
  hasResult: boolean;
  gamePlayId?: string;
  gift?: PublicGameGiftDto;
  bookingExpiresAt?: Date;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function catalogIsWithinActiveWindow(
  catalog: {
    activeFrom: Date | null;
    activeTo: Date | null;
  },
  now: Date,
): boolean {
  if (catalog.activeFrom && now.getTime() < catalog.activeFrom.getTime()) {
    return false;
  }
  if (catalog.activeTo && now.getTime() > catalog.activeTo.getTime()) {
    return false;
  }
  return true;
}

export async function resolveActiveGameCatalog(
  catalogSlug: string,
  now: Date = new Date(),
): Promise<ResolvedGameCatalog> {
  const slug = normalizeGameSlug(catalogSlug);
  if (!slug) {
    throw new GameSessionError("GAME_INVALID_REQUEST", "catalogSlug обязателен");
  }

  const catalog = await prisma.gameCatalog.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      campaignKey: true,
      rulesVersion: true,
      legacyConfigId: true,
      activeFrom: true,
      activeTo: true,
    },
  });

  if (!catalog || catalog.status !== "ACTIVE") {
    throw new GameSessionError("GAME_UNAVAILABLE", "Игра временно недоступна");
  }

  if (!catalogIsWithinActiveWindow(catalog, now)) {
    throw new GameSessionError("GAME_UNAVAILABLE", "Игра временно недоступна");
  }

  const mechanicType = mechanicTypeFromCatalog(catalog.type);
  if (mechanicType === "WHEEL_OF_FORTUNE") {
    throw new GameSessionError(
      "GAME_MECHANIC_UNSUPPORTED",
      "Механика игры пока недоступна",
    );
  }

  const studioSettings = await getStudioSettings();
  if (!studioSettings.isGameEnabled) {
    throw new GameSessionError("GAME_UNAVAILABLE", "Игра временно недоступна");
  }

  const configId = catalog.legacyConfigId ?? "default";
  const config = await prisma.gameConfig.findUnique({
    where: { id: configId },
    select: { isActive: true },
  });

  if (!config?.isActive) {
    throw new GameSessionError("GAME_UNAVAILABLE", "Игра временно недоступна");
  }

  return {
    id: catalog.id,
    slug: catalog.slug,
    title: catalog.title,
    type: catalog.type,
    campaignKey: catalog.campaignKey,
    rulesVersion: catalog.rulesVersion,
    legacyConfigId: catalog.legacyConfigId,
    mechanicType,
  };
}

export function ensureVisitorAuth(
  auth: SessionAuthContext,
): {
  visitorToken: string;
  visitorTokenHash: string;
  cookieOperations: CookieOperation[];
} {
  const cookieOperations: CookieOperation[] = [];
  const visitorToken = auth.visitorToken?.trim() || generateOpaqueToken();

  if (!auth.visitorToken?.trim()) {
    cookieOperations.push(buildVisitorSetOperation(visitorToken));
  }

  return {
    visitorToken,
    visitorTokenHash: hashOpaqueToken(visitorToken),
    cookieOperations,
  };
}

async function countRecentSessions(
  browserVisitorHash: string,
  gameCatalogId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - SESSION_LIMIT_WINDOW_MS);
  return prisma.gameSession.count({
    where: {
      browserVisitorHash,
      gameCatalogId,
      startedAt: { gte: since },
    },
  });
}

async function findSessionForCatalog(
  gameCatalogId: string,
  tokenHash: string,
): Promise<Awaited<ReturnType<typeof prisma.gameSession.findFirst>>> {
  return prisma.gameSession.findFirst({
    where: {
      gameCatalogId,
      tokenHash,
    },
  });
}

function sessionExpiryForResponse(
  session: { status: string; playExpiresAt: Date; claimExpiresAt: Date | null },
): Date {
  if (session.status === "COMPLETED" && session.claimExpiresAt) {
    return session.claimExpiresAt;
  }
  return session.playExpiresAt;
}

function mapPublicGift(snapshot: GiftSnapshot): PublicGameGiftDto {
  const gift = publicGiftFromSnapshot(snapshot);
  if (!gift) {
    throw new GameSessionError(
      "GAME_RESULT_UNAVAILABLE",
      "Результат игры недоступен",
    );
  }
  return gift;
}

export async function startGameSession(
  catalogSlug: string,
  auth: SessionAuthContext,
  now: Date = new Date(),
): Promise<StartGameSessionResult> {
  const catalog = await resolveActiveGameCatalog(catalogSlug, now);
  const visitor = ensureVisitorAuth(auth);
  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const cookieOperations = [...visitor.cookieOperations];

  const existingToken = auth.sessionToken?.trim() || null;
  if (existingToken) {
    const existing = await findSessionForCatalog(
      catalog.id,
      hashOpaqueToken(existingToken),
    );

    if (existing) {
      const session = await expireGameSessionIfNeededWithDb(existing, now);
      if (session.status === "ACTIVE") {
        return {
          status: "ACTIVE",
          expiresAt: session.playExpiresAt,
          hasResult: false,
          mechanicType: catalog.mechanicType,
          sessionToken: existingToken,
          cookieOperations: [
            ...cookieOperations,
            buildSessionSetOperation(
              cookieName,
              existingToken,
              session.playExpiresAt,
              now,
            ),
          ],
        };
      }

      if (session.status === "COMPLETED") {
        const expiresAt = sessionExpiryForResponse(session);
        return {
          status: "COMPLETED",
          expiresAt,
          hasResult: true,
          mechanicType: catalog.mechanicType,
          sessionToken: existingToken,
          cookieOperations: [
            ...cookieOperations,
            buildSessionSetOperation(cookieName, existingToken, expiresAt, now),
          ],
        };
      }

      cookieOperations.push(buildSessionDeleteOperation(cookieName));
    }
  }

  const recentCount = await countRecentSessions(
    visitor.visitorTokenHash,
    catalog.id,
    now,
  );
  if (recentCount >= SESSION_START_LIMIT) {
    throw new GameSessionError(
      "GAME_SESSION_LIMIT",
      "Превышен лимит игровых попыток. Попробуйте позже.",
    );
  }

  const sessionToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(sessionToken);
  const playExpiresAt = new Date(now.getTime() + PLAY_WINDOW_MS);

  await prisma.gameSession.create({
    data: {
      gameCatalogId: catalog.id,
      tokenHash,
      browserVisitorHash: visitor.visitorTokenHash,
      status: "ACTIVE",
      playExpiresAt,
      startedAt: now,
    },
  });

  cookieOperations.push(
    buildSessionSetOperation(cookieName, sessionToken, playExpiresAt, now),
  );

  return {
    status: "ACTIVE",
    expiresAt: playExpiresAt,
    hasResult: false,
    mechanicType: catalog.mechanicType,
    sessionToken,
    cookieOperations,
  };
}

async function loadCompletedPlay(sessionId: string) {
  return prisma.gamePlay.findUnique({
    where: { gameSessionId: sessionId },
    select: {
      id: true,
      giftSnapshot: true,
      completedAt: true,
    },
  });
}

async function completeActiveSession(
  catalog: ResolvedGameCatalog,
  session: { id: string; playExpiresAt: Date },
  playInput: {
    gameDirection: string;
    skinNeed: string;
    resultType: string;
    premiumLevel: number;
    clientMetrics: GameSessionClientMetrics | null;
  },
  sessionToken: string,
  now: Date,
): Promise<CompleteGameSessionResult> {
  const gifts = await prisma.gameGift.findMany({
    where: {
      isActive: true,
      gameCatalogId: catalog.id,
    },
    orderBy: [{ probability: "desc" }, { createdAt: "asc" }],
  });

  const eligible = buildCatalogScopedGiftPool(gifts, catalog.id, SERVER_RESULT_TIER);
  const picked = weightedGiftPick(eligible);
  if (!picked) {
    throw new GameSessionError(
      "GAME_RESULT_UNAVAILABLE",
      "Подарки временно недоступны",
    );
  }

  const completedAt = now;
  const claimExpiresAt = new Date(completedAt.getTime() + CLAIM_WINDOW_MS);
  const giftSnapshot = buildGiftSnapshot(picked, completedAt);
  const rulesSnapshot = buildRulesSnapshot({
    campaignKey: catalog.campaignKey,
    rulesVersion: catalog.rulesVersion,
    mechanicType: catalog.mechanicType,
    serverResultTier: SERVER_RESULT_TIER,
    catalogSlug: catalog.slug,
    catalogTitle: catalog.title,
    bookingWindowHours: BOOKING_WINDOW_HOURS,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.gameSession.findFirst({
        where: { id: session.id },
      });
      if (!locked) {
        throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
      }

      const current = await expireGameSessionIfNeededWithDb(locked, now, tx);
      const existingPlay = await tx.gamePlay.findUnique({
        where: { gameSessionId: current.id },
        select: { id: true, giftSnapshot: true },
      });

      if (existingPlay) {
        const snapshot = parseGiftSnapshot(existingPlay.giftSnapshot);
        if (!snapshot) {
          throw new GameSessionError(
            "GAME_RESULT_UNAVAILABLE",
            "Результат игры недоступен",
          );
        }
        return {
          gamePlayId: existingPlay.id,
          gift: mapPublicGift(snapshot),
          bookingExpiresAt: claimExpiresAt,
        };
      }

      if (current.status === "CONSUMED") {
        throw new GameSessionError(
          "GAME_RESULT_UNAVAILABLE",
          "Результат игры уже использован",
        );
      }

      if (current.status !== "ACTIVE") {
        throw new GameSessionError(
          "GAME_SESSION_EXPIRED",
          "Время игры истекло. Начните заново.",
        );
      }

      if (now.getTime() >= current.playExpiresAt.getTime()) {
        await tx.gameSession.updateMany({
          where: { id: current.id, status: "ACTIVE" },
          data: { status: "EXPIRED" },
        });
        throw new GameSessionError(
          "GAME_SESSION_EXPIRED",
          "Время игры истекло. Начните заново.",
        );
      }

      const play = await tx.gamePlay.create({
        data: {
          gameDirection: playInput.gameDirection,
          skinNeed: playInput.skinNeed,
          resultType: playInput.resultType,
          premiumLevel: playInput.premiumLevel,
          gameCatalogId: catalog.id,
          gameSessionId: current.id,
          selectedGiftId: picked.id,
          serverResultTier: SERVER_RESULT_TIER,
          campaignKey: catalog.campaignKey,
          rulesVersion: catalog.rulesVersion,
          giftSnapshot: giftSnapshot as Prisma.InputJsonValue,
          rulesSnapshot: rulesSnapshot as Prisma.InputJsonValue,
          clientMetrics: playInput.clientMetrics
            ? (playInput.clientMetrics as Prisma.InputJsonValue)
            : undefined,
          completedAt,
        },
        select: { id: true },
      });

      const updated = await tx.gameSession.updateMany({
        where: {
          id: current.id,
          status: "ACTIVE",
        },
        data: {
          status: "COMPLETED",
          completedAt,
          claimExpiresAt,
        },
      });

      if (updated.count !== 1) {
        const racedPlay = await tx.gamePlay.findUnique({
          where: { gameSessionId: current.id },
          select: { id: true, giftSnapshot: true },
        });
        if (racedPlay) {
          const snapshot = parseGiftSnapshot(racedPlay.giftSnapshot);
          if (snapshot) {
            return {
              gamePlayId: racedPlay.id,
              gift: mapPublicGift(snapshot),
              bookingExpiresAt: claimExpiresAt,
            };
          }
        }
        throw new GameSessionError(
          "GAME_RESULT_UNAVAILABLE",
          "Результат игры недоступен",
        );
      }

      return {
        gamePlayId: play.id,
        gift: mapPublicGift(giftSnapshot),
        bookingExpiresAt: claimExpiresAt,
      };
    });

    const cookieName = buildCatalogSessionCookieName(catalog.slug);
    return {
      ...result,
      cookieOperations: [
        buildSessionSetOperation(
          cookieName,
          sessionToken,
          result.bookingExpiresAt,
          now,
        ),
      ],
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const racedPlay = await loadCompletedPlay(session.id);
      if (racedPlay) {
        const snapshot = parseGiftSnapshot(racedPlay.giftSnapshot);
        if (snapshot) {
          const bookingExpiresAt = new Date(
            (racedPlay.completedAt ?? now).getTime() + CLAIM_WINDOW_MS,
          );
          const cookieName = buildCatalogSessionCookieName(catalog.slug);
          return {
            gamePlayId: racedPlay.id,
            gift: mapPublicGift(snapshot),
            bookingExpiresAt,
            cookieOperations: [
              buildSessionSetOperation(
                cookieName,
                sessionToken,
                bookingExpiresAt,
                now,
              ),
            ],
          };
        }
      }
    }
    throw error;
  }
}

export async function completeGameSession(
  input: CompleteGameSessionInput,
  now: Date = new Date(),
): Promise<CompleteGameSessionResult> {
  const catalog = await resolveActiveGameCatalog(input.catalogSlug, now);
  const sessionToken =
    input.sessionTokenOverride?.trim() || input.auth.sessionToken?.trim() || null;

  if (!sessionToken) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const session = await findSessionForCatalog(
    catalog.id,
    hashOpaqueToken(sessionToken),
  );
  if (!session) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const current = await expireGameSessionIfNeededWithDb(session, now);

  if (current.status === "COMPLETED" || current.status === "CONSUMED") {
    const play = await loadCompletedPlay(current.id);
    if (!play) {
      throw new GameSessionError(
        "GAME_RESULT_UNAVAILABLE",
        "Результат игры недоступен",
      );
    }
    const snapshot = parseGiftSnapshot(play.giftSnapshot);
    if (!snapshot) {
      throw new GameSessionError(
        "GAME_RESULT_UNAVAILABLE",
        "Результат игры недоступен",
      );
    }

    const bookingExpiresAt =
      current.claimExpiresAt ??
      new Date((play.completedAt ?? now).getTime() + CLAIM_WINDOW_MS);

    if (current.status === "CONSUMED") {
      return {
        gamePlayId: play.id,
        gift: mapPublicGift(snapshot),
        bookingExpiresAt,
        cookieOperations: [],
      };
    }

    const cookieName = buildCatalogSessionCookieName(catalog.slug);
    return {
      gamePlayId: play.id,
      gift: mapPublicGift(snapshot),
      bookingExpiresAt,
      cookieOperations: [
        buildSessionSetOperation(cookieName, sessionToken, bookingExpiresAt, now),
      ],
    };
  }

  if (current.status !== "ACTIVE") {
    throw new GameSessionError(
      "GAME_SESSION_EXPIRED",
      "Время игры истекло. Начните заново.",
    );
  }

  return completeActiveSession(
    catalog,
    current,
    {
      gameDirection: input.gameDirection,
      skinNeed: input.skinNeed,
      resultType: input.resultType,
      premiumLevel: input.premiumLevel,
      clientMetrics: input.clientMetrics,
    },
    sessionToken,
    now,
  );
}

export async function resolveGameCatalogSlug(
  catalogSlug: string,
): Promise<{ id: string; slug: string }> {
  const slug = normalizeGameSlug(catalogSlug);
  if (!slug) {
    throw new GameSessionError("GAME_INVALID_REQUEST", "catalogSlug обязателен");
  }

  const catalog = await prisma.gameCatalog.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });

  if (!catalog) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  return catalog;
}

export async function getGameSessionResult(
  catalogSlug: string,
  auth: SessionAuthContext,
  now: Date = new Date(),
): Promise<GameSessionResultData> {
  const catalog = await resolveGameCatalogSlug(catalogSlug);
  const sessionToken = auth.sessionToken?.trim();
  if (!sessionToken) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const session = await findSessionForCatalog(
    catalog.id,
    hashOpaqueToken(sessionToken),
  );
  if (!session) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const current = await expireGameSessionIfNeededWithDb(session, now);

  if (current.status === "ACTIVE") {
    return {
      status: "ACTIVE",
      hasResult: false,
    };
  }

  if (current.status === "EXPIRED") {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const play = await loadCompletedPlay(current.id);
  if (!play) {
    throw new GameSessionError(
      "GAME_RESULT_UNAVAILABLE",
      "Результат игры недоступен",
    );
  }

  const snapshot = parseGiftSnapshot(play.giftSnapshot);
  if (!snapshot) {
    throw new GameSessionError(
      "GAME_RESULT_UNAVAILABLE",
      "Результат игры недоступен",
    );
  }

  const bookingExpiresAt =
    current.claimExpiresAt ??
    new Date((play.completedAt ?? now).getTime() + CLAIM_WINDOW_MS);

  return {
    status: current.status === "CONSUMED" ? "CONSUMED" : "COMPLETED",
    hasResult: true,
    gamePlayId: play.id,
    gift: mapPublicGift(snapshot),
    bookingExpiresAt,
  };
}

export async function runGamePlayAdapter(input: {
  catalogSlug: string | null;
  auth: SessionAuthContext;
  gameDirection: string;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
}): Promise<{
  playId: string;
  gift: PublicGameGiftDto;
  cookieOperations: CookieOperation[];
}> {
  const catalogSlug = input.catalogSlug?.trim() || "procedure-gift";
  const start = await startGameSession(catalogSlug, input.auth);
  const complete = await completeGameSession({
    catalogSlug,
    auth: input.auth,
    sessionTokenOverride: start.sessionToken,
    gameDirection: input.gameDirection,
    skinNeed: input.skinNeed,
    resultType: input.resultType,
    premiumLevel: input.premiumLevel,
    clientMetrics: null,
  });

  return {
    playId: complete.gamePlayId,
    gift: complete.gift,
    cookieOperations: [...start.cookieOperations, ...complete.cookieOperations],
  };
}
