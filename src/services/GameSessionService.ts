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
import {
  GameSessionError,
  GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE,
} from "@/lib/game/session/game-session-errors";
import { expireGameSessionIfNeededWithDb } from "@/lib/game/session/game-session-expiration";
import {
  canRestartSession,
  isPlayRewardConsumed,
  resolveEffectiveSessionStatus,
  shouldReuseSessionForStart,
} from "@/lib/game/session/game-session-reuse-rules";
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
import {
  assignmentToJson,
  parseServerAssignment,
  type CatchTimeServerAssignmentV1,
} from "@/lib/game/tier/server-assignment";
import { buildServerAssignment } from "@/lib/game/tier/server-tier-assignment";
import { getStudioSettings } from "@/services/StudioSettingsService";

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
  settings: unknown;
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
  bookingSubmitted: boolean;
};

export type RestartGameSessionResult = {
  status: "ACTIVE";
  expiresAt: Date;
  hasResult: false;
  mechanicType: GameMechanicTypeDto;
  sessionToken: string;
  cookieOperations: CookieOperation[];
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
      settings: true,
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
    settings: catalog.settings,
  };
}

function buildCatalogServerAssignment(
  catalog: ResolvedGameCatalog,
  now: Date,
): CatchTimeServerAssignmentV1 {
  return buildServerAssignment({
    mechanicType: "CATCH_TIME",
    catalogCampaignKey: catalog.campaignKey,
    catalogRulesVersion: catalog.rulesVersion,
    settingsRaw: catalog.settings,
    now,
  });
}

async function ensureSessionServerAssignment(
  session: {
    id: string;
    status: string;
    serverAssignment: Prisma.JsonValue | null;
  },
  catalog: ResolvedGameCatalog,
  now: Date,
): Promise<CatchTimeServerAssignmentV1> {
  const existing = parseServerAssignment(session.serverAssignment);
  if (existing) {
    return existing;
  }

  const assignment = buildCatalogServerAssignment(catalog, now);
  const assignmentJson = assignmentToJson(assignment) as Prisma.InputJsonValue;

  if (session.status !== "ACTIVE") {
    return assignment;
  }

  await prisma.gameSession.updateMany({
    where: {
      id: session.id,
      serverAssignment: { equals: Prisma.DbNull },
    },
    data: { serverAssignment: assignmentJson },
  });

  const refreshed = await prisma.gameSession.findUnique({
    where: { id: session.id },
    select: { serverAssignment: true },
  });
  const persisted = parseServerAssignment(refreshed?.serverAssignment ?? null);
  if (persisted) {
    return persisted;
  }

  await prisma.gameSession.update({
    where: { id: session.id },
    data: { serverAssignment: assignmentJson },
  });

  return assignment;
}

function resolveSessionServerResultTier(
  assignment: CatchTimeServerAssignmentV1,
): number {
  return assignment.serverResultTier;
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

async function assertVisitorCanStartNewGameAttempt(
  browserVisitorHash: string,
  gameCatalogId: string,
  now: Date = new Date(),
): Promise<void> {
  const since = new Date(now.getTime() - SESSION_LIMIT_WINDOW_MS);

  const submittedSession = await prisma.gameSession.findFirst({
    where: {
      browserVisitorHash,
      gameCatalogId,
      startedAt: { gte: since },
      OR: [
        {
          status: "CONSUMED",
          consumedAt: { gte: since },
          gamePlay: { is: { leadId: { not: null } } },
        },
        {
          status: "COMPLETED",
          gamePlay: { is: { leadId: { not: null } } },
        },
      ],
    },
    select: { id: true },
  });

  if (submittedSession) {
    throw new GameSessionError(
      "GAME_BOOKING_ALREADY_SUBMITTED",
      GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE,
    );
  }
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

async function loadSessionPlayReuseSnapshot(sessionId: string) {
  return prisma.gamePlay.findUnique({
    where: { gameSessionId: sessionId },
    select: {
      id: true,
      leadId: true,
      consumedAt: true,
    },
  });
}

async function reconcileCompletedSessionConsumption(
  session: {
    id: string;
    status: string;
    consumedAt: Date | null;
  },
  now: Date,
): Promise<{ status: string; consumedAt: Date | null }> {
  if (session.status !== "COMPLETED") {
    return {
      status: session.status,
      consumedAt: session.consumedAt,
    };
  }

  const play = await loadSessionPlayReuseSnapshot(session.id);
  if (!isPlayRewardConsumed(play)) {
    return {
      status: session.status,
      consumedAt: session.consumedAt,
    };
  }

  const consumedAt = play?.consumedAt ?? session.consumedAt ?? now;
  await prisma.gameSession.updateMany({
    where: {
      id: session.id,
      status: "COMPLETED",
      consumedAt: null,
    },
    data: {
      status: "CONSUMED",
      consumedAt,
    },
  });

  return {
    status: "CONSUMED",
    consumedAt,
  };
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
      const expired = await expireGameSessionIfNeededWithDb(existing, now);
      const reconciled = await reconcileCompletedSessionConsumption(expired, now);
      const play = await loadSessionPlayReuseSnapshot(expired.id);
      const effectiveStatus = resolveEffectiveSessionStatus({
        status: reconciled.status,
        play,
      });

      if (shouldReuseSessionForStart({ status: effectiveStatus, play })) {
        if (effectiveStatus === "ACTIVE") {
          await ensureSessionServerAssignment(expired, catalog, now);
          return {
            status: "ACTIVE",
            expiresAt: expired.playExpiresAt,
            hasResult: false,
            mechanicType: catalog.mechanicType,
            sessionToken: existingToken,
            cookieOperations: [
              ...cookieOperations,
              buildSessionSetOperation(
                cookieName,
                existingToken,
                expired.playExpiresAt,
                now,
              ),
            ],
          };
        }

        if (effectiveStatus === "COMPLETED") {
          const expiresAt = sessionExpiryForResponse(expired);
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

  await assertVisitorCanStartNewGameAttempt(
    visitor.visitorTokenHash,
    catalog.id,
    now,
  );

  const sessionToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(sessionToken);
  const playExpiresAt = new Date(now.getTime() + PLAY_WINDOW_MS);
  const serverAssignment = assignmentToJson(
    buildCatalogServerAssignment(catalog, now),
  ) as Prisma.InputJsonValue;

  await prisma.gameSession.create({
    data: {
      gameCatalogId: catalog.id,
      tokenHash,
      browserVisitorHash: visitor.visitorTokenHash,
      status: "ACTIVE",
      playExpiresAt,
      startedAt: now,
      serverAssignment,
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

export async function restartGameSession(
  catalogSlug: string,
  auth: SessionAuthContext,
  now: Date = new Date(),
): Promise<RestartGameSessionResult> {
  const catalog = await resolveActiveGameCatalog(catalogSlug, now);
  const visitor = ensureVisitorAuth(auth);
  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const cookieOperations = [...visitor.cookieOperations];

  await assertVisitorCanStartNewGameAttempt(
    visitor.visitorTokenHash,
    catalog.id,
    now,
  );

  const existingToken = auth.sessionToken?.trim() || null;
  if (!existingToken) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const existing = await findSessionForCatalog(
    catalog.id,
    hashOpaqueToken(existingToken),
  );
  if (!existing) {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const expired = await expireGameSessionIfNeededWithDb(existing, now);
  const reconciled = await reconcileCompletedSessionConsumption(expired, now);
  const play = await loadSessionPlayReuseSnapshot(expired.id);
  const effectiveStatus = resolveEffectiveSessionStatus({
    status: reconciled.status,
    play,
  });

  if (
    !canRestartSession({
      status: effectiveStatus,
      play,
    })
  ) {
    if (
      effectiveStatus === "CONSUMED" ||
      isPlayRewardConsumed(play)
    ) {
      throw new GameSessionError(
        "GAME_BOOKING_ALREADY_SUBMITTED",
        GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE,
      );
    }
    throw new GameSessionError(
      "GAME_SESSION_EXPIRED",
      "Время игры истекло. Начните заново.",
    );
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
  const serverAssignment = assignmentToJson(
    buildCatalogServerAssignment(catalog, now),
  ) as Prisma.InputJsonValue;

  await prisma.$transaction(async (tx) => {
    const locked = await tx.gameSession.findFirst({
      where: { id: expired.id },
    });
    if (!locked) {
      throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
    }

    const current = await expireGameSessionIfNeededWithDb(locked, now, tx);
    const lockedPlay = await tx.gamePlay.findUnique({
      where: { gameSessionId: current.id },
      select: { leadId: true, consumedAt: true },
    });
    const lockedStatus = resolveEffectiveSessionStatus({
      status: current.status,
      play: lockedPlay,
    });

    if (
      !canRestartSession({
        status: lockedStatus,
        play: lockedPlay,
      })
    ) {
      if (lockedStatus === "CONSUMED" || isPlayRewardConsumed(lockedPlay)) {
        throw new GameSessionError(
          "GAME_BOOKING_ALREADY_SUBMITTED",
          GAME_BOOKING_ALREADY_SUBMITTED_MESSAGE,
        );
      }
      throw new GameSessionError(
        "GAME_RESULT_UNAVAILABLE",
        "Результат игры недоступен",
      );
    }

    const limitCount = await tx.gameSession.count({
      where: {
        browserVisitorHash: visitor.visitorTokenHash,
        gameCatalogId: catalog.id,
        startedAt: { gte: new Date(now.getTime() - SESSION_LIMIT_WINDOW_MS) },
      },
    });
    if (limitCount >= SESSION_START_LIMIT) {
      throw new GameSessionError(
        "GAME_SESSION_LIMIT",
        "Превышен лимит игровых попыток. Попробуйте позже.",
      );
    }

    if (current.status === "ACTIVE") {
      const updated = await tx.gameSession.updateMany({
        where: { id: current.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) {
        throw new GameSessionError(
          "GAME_RESULT_UNAVAILABLE",
          "Результат игры недоступен",
        );
      }
    } else if (current.status === "COMPLETED") {
      const updated = await tx.gameSession.updateMany({
        where: { id: current.id, status: "COMPLETED" },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) {
        throw new GameSessionError(
          "GAME_RESULT_UNAVAILABLE",
          "Результат игры недоступен",
        );
      }
    } else {
      throw new GameSessionError(
        "GAME_RESULT_UNAVAILABLE",
        "Результат игры недоступен",
      );
    }

    await tx.gameSession.create({
      data: {
        gameCatalogId: catalog.id,
        tokenHash,
        browserVisitorHash: visitor.visitorTokenHash,
        status: "ACTIVE",
        playExpiresAt,
        startedAt: now,
        serverAssignment,
      },
    });
  });

  cookieOperations.push(buildSessionDeleteOperation(cookieName));
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
  session: {
    id: string;
    playExpiresAt: Date;
    serverAssignment: Prisma.JsonValue | null;
  },
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
  const assignment = await ensureSessionServerAssignment(
    { id: session.id, status: "ACTIVE", serverAssignment: session.serverAssignment },
    catalog,
    now,
  );
  const serverResultTier = resolveSessionServerResultTier(assignment);

  const gifts = await prisma.gameGift.findMany({
    where: {
      isActive: true,
      gameCatalogId: catalog.id,
    },
    orderBy: [{ probability: "desc" }, { createdAt: "asc" }],
  });

  const eligible = buildCatalogScopedGiftPool(gifts, catalog.id, serverResultTier);
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
    campaignKey: assignment.campaignKey,
    rulesVersion: assignment.rulesVersion,
    mechanicType: catalog.mechanicType,
    serverResultTier,
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
          serverResultTier,
          campaignKey: assignment.campaignKey,
          rulesVersion: assignment.rulesVersion,
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
      bookingSubmitted: false,
    };
  }

  if (current.status === "EXPIRED") {
    throw new GameSessionError("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена");
  }

  const reconciled = await reconcileCompletedSessionConsumption(current, now);
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

  const playReuse = await loadSessionPlayReuseSnapshot(current.id);
  const effectiveStatus = resolveEffectiveSessionStatus({
    status: reconciled.status,
    play: playReuse,
  });
  const bookingSubmitted =
    effectiveStatus === "CONSUMED" || isPlayRewardConsumed(playReuse);

  return {
    status: bookingSubmitted ? "CONSUMED" : "COMPLETED",
    hasResult: true,
    gamePlayId: play.id,
    gift: mapPublicGift(snapshot),
    bookingExpiresAt,
    bookingSubmitted,
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
  const catalog = await resolveActiveGameCatalog(catalogSlug);
  const visitor = ensureVisitorAuth(input.auth);
  await assertVisitorCanStartNewGameAttempt(
    visitor.visitorTokenHash,
    catalog.id,
  );

  let auth = input.auth;
  const cookieOperations: CookieOperation[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const start = await startGameSession(catalogSlug, auth);
    cookieOperations.push(...start.cookieOperations);

    const complete = await completeGameSession({
      catalogSlug,
      auth,
      sessionTokenOverride: start.sessionToken,
      gameDirection: input.gameDirection,
      skinNeed: input.skinNeed,
      resultType: input.resultType,
      premiumLevel: input.premiumLevel,
      clientMetrics: null,
    });
    cookieOperations.push(...complete.cookieOperations);

    const play = await prisma.gamePlay.findUnique({
      where: { id: complete.gamePlayId },
      select: {
        leadId: true,
        consumedAt: true,
        gameSession: {
          select: { status: true },
        },
      },
    });

    const consumedResult =
      isPlayRewardConsumed(play) || play?.gameSession?.status === "CONSUMED";

    if (!consumedResult) {
      return {
        playId: complete.gamePlayId,
        gift: complete.gift,
        cookieOperations,
      };
    }

    auth = {
      visitorToken: auth.visitorToken,
      sessionToken: null,
    };
  }

  throw new GameSessionError(
    "GAME_RESULT_UNAVAILABLE",
    "Результат игры недоступен",
  );
}
