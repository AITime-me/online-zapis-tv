import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import {
  buildCatalogSessionCookieName,
  buildSessionSetOperation,
  CLAIM_WINDOW_MS,
  PLAY_WINDOW_MS,
  type CookieOperation,
} from "@/lib/game/session/game-session-cookie";
import type { SessionAuthContext } from "@/lib/game/session/game-session-contract";
import {
  buildRulesSnapshot,
  parseGiftSnapshot,
} from "@/lib/game/session/game-session-snapshot";
import { hashOpaqueToken } from "@/lib/game/session/game-session-token";
import { normalizeGameSlug } from "@/lib/games/catalog-contract";
import { isValidWheelAttemptId } from "@/lib/game/wheel/client-attempt-id";
import { parseWheelServerAssignment } from "@/lib/game/wheel/parse-wheel-assignment";
import {
  mapToWheelInterestKey,
  wheelInterestToPublicKey,
  WHEEL_PUBLIC_INTEREST_LABELS,
  type WheelPublicInterestKey,
} from "@/lib/game/wheel/public-interest";
import { registerWheelPhoneBoundSession } from "@/lib/game/wheel/register-phone-bound-session";
import {
  giftsToSectorGifts,
  assertWheelCatalogReadyForActivation,
} from "@/lib/game/wheel/wheel-admin";
import { buildWheelServerAssignment } from "@/lib/game/wheel/wheel-assignment";
import {
  enrichWheelAssignmentWithPrizeSnapshot,
  type WheelPrizeCatalogGift,
} from "@/lib/game/wheel/wheel-assignment-prize-snapshot";
import {
  buildWheelCompleteGiftSnapshot,
  prizeDisplayNameFromAssignment,
} from "@/lib/game/wheel/wheel-public-complete-snapshot";
import { buildPublicSectorLabels } from "@/lib/game/wheel/wheel-public-labels";
import {
  assertSafeWheelPublicPayload,
  buildWheelPublicAnimationResult,
  type WheelPublicCompleteResponse,
  type WheelPublicResultResponse,
  type WheelPublicSessionStatus,
  type WheelPublicStartResponse,
  type WheelPublicStartServiceResult,
} from "@/lib/game/wheel/wheel-public-dto";
import { assertWheelSessionPhoneMatches } from "@/lib/game/wheel/wheel-public-session-phone";
import type { WheelAwareGiftSnapshot } from "@/lib/game/wheel/wheel-gift-snapshot";
import type { WheelInterestKey } from "@/lib/game/wheel/procedure-types";
import { validateClaimZoneForInterest } from "@/lib/game/wheel/zone-resolution";
import { createBookingRequest } from "@/services/BookingRequestService";
import { ensureVisitorAuth } from "@/services/GameSessionService";
import { getStudioSettings } from "@/services/StudioSettingsService";

export { buildPublicSectorLabels };

const BOOKING_WINDOW_HOURS = 24;

export class WheelPublicGameError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "WheelPublicGameError";
    this.code = code;
    this.status = status;
  }
}

type WheelCatalogRow = {
  id: string;
  slug: string;
  title: string;
  type: "WHEEL_OF_FORTUNE" | "CATCH_TIME";
  status: "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  settings: Prisma.JsonValue | null;
  campaignKey: string | null;
  rulesVersion: string;
  activeFrom: Date | null;
  activeTo: Date | null;
};

function throwWheel(code: string, message: string, status = 400): never {
  throw new WheelPublicGameError(code, message, status);
}

async function loadWheelCatalogBySlug(
  catalogSlug: string,
  db: PrismaClient,
): Promise<WheelCatalogRow> {
  const slug = normalizeGameSlug(catalogSlug);
  if (!slug) {
    throwWheel("GAME_INVALID_REQUEST", "catalogSlug обязателен");
  }

  const catalog = await db.gameCatalog.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      settings: true,
      campaignKey: true,
      rulesVersion: true,
      activeFrom: true,
      activeTo: true,
    },
  });

  if (!catalog || catalog.type !== "WHEEL_OF_FORTUNE") {
    throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 404);
  }

  return catalog;
}

async function assertWheelPubliclyPlayable(
  catalog: WheelCatalogRow,
  now: Date,
  options?: { isGameEnabled?: boolean },
): Promise<void> {
  if (catalog.status !== "ACTIVE") {
    throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 404);
  }
  if (catalog.activeFrom && now < catalog.activeFrom) {
    throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 404);
  }
  if (catalog.activeTo && now > catalog.activeTo) {
    throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 404);
  }

  const isGameEnabled =
    options?.isGameEnabled ?? (await getStudioSettings()).isGameEnabled;
  if (!isGameEnabled) {
    throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 404);
  }
}

async function loadSectorGifts(
  catalogId: string,
  db: PrismaClient,
): Promise<WheelPrizeCatalogGift[]> {
  return db.gameGift.findMany({
    where: { gameCatalogId: catalogId },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      image: true,
      priority: true,
      cardStyle: true,
      isActive: true,
      probability: true,
      systemKey: true,
      sortOrder: true,
      prizeType: true,
      prizeRules: true,
      activationMode: true,
      minCourseSessions: true,
      activationConditionText: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function assertWheelCatalogConfigValid(
  catalogId: string,
  settingsRaw?: unknown,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  try {
    await assertWheelCatalogReadyForActivation(catalogId, settingsRaw, db);
  } catch (error) {
    throwWheel(
      "WHEEL_CONFIG_INVALID",
      error instanceof Error
        ? error.message
        : "Конфигурация колеса невалидна",
    );
  }
}

function mapSessionStatus(
  status: string,
  playExpiresAt: Date | null,
  now: Date,
): WheelPublicSessionStatus {
  if (status === "CONSUMED") return "CONSUMED";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "EXPIRED") return "EXPIRED";
  if (
    status === "ACTIVE" &&
    playExpiresAt &&
    now.getTime() >= playExpiresAt.getTime()
  ) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

function snapshotDisplayNames(snapshot: WheelAwareGiftSnapshot | null): {
  originalName: string;
  finalName: string;
  replacementApplied: boolean;
} {
  const originalName =
    snapshot?.originalPrize?.name?.trim() ||
    snapshot?.name?.trim() ||
    "Приз";
  const finalName =
    snapshot?.finalPrize?.name?.trim() ||
    snapshot?.name?.trim() ||
    originalName;
  return {
    originalName,
    finalName,
    replacementApplied: Boolean(snapshot?.replacementApplied),
  };
}

function resolveLockedInterest(
  existingSnapshot: WheelAwareGiftSnapshot | null,
  requested: WheelInterestKey,
): WheelInterestKey {
  const locked = existingSnapshot?.confirmedInterest ?? null;
  return locked ?? requested;
}

async function lockWheelSessionRow(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT id FROM game_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`,
  );
}

export async function startWheelPublicGame(input: {
  catalogSlug: string;
  name: string;
  phone: string;
  attemptId: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  auth: SessionAuthContext;
  now?: Date;
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  isGameEnabled?: boolean;
}): Promise<WheelPublicStartServiceResult & { cookieOperations: CookieOperation[] }> {
  const now = input.now ?? new Date();
  const db = input.db ?? defaultPrisma;

  if (input.personalDataConsent !== true || input.offerAcknowledgement !== true) {
    throwWheel(
      "WHEEL_CONSENT_REQUIRED",
      "Необходимо принять обязательные согласия",
    );
  }
  if (!input.name.trim()) {
    throwWheel("GAME_INVALID_REQUEST", "Укажите имя");
  }
  if (!input.phone.trim()) {
    throwWheel("GAME_INVALID_REQUEST", "Укажите телефон");
  }
  if (!isValidWheelAttemptId(input.attemptId)) {
    throwWheel("GAME_INVALID_REQUEST", "attemptId некорректен");
  }

  const catalog = await loadWheelCatalogBySlug(input.catalogSlug, db);
  await assertWheelPubliclyPlayable(catalog, now, {
    isGameEnabled: input.isGameEnabled,
  });
  await assertWheelCatalogConfigValid(catalog.id, catalog.settings, db);

  const visitor = ensureVisitorAuth(input.auth);
  const gifts = await loadSectorGifts(catalog.id, db);
  const assignmentBase = buildWheelServerAssignment({
    catalogCampaignKey: catalog.campaignKey,
    catalogRulesVersion: catalog.rulesVersion,
    settingsRaw: catalog.settings,
    gifts: giftsToSectorGifts(gifts),
    now,
  });
  if (!assignmentBase) {
    throwWheel("WHEEL_CONFIG_INVALID", "Конфигурация колеса невалидна");
  }

  const assignment = enrichWheelAssignmentWithPrizeSnapshot(
    assignmentBase,
    gifts,
  );
  if (!assignment) {
    throwWheel("WHEEL_CONFIG_INVALID", "Конфигурация колеса невалидна");
  }

  const playExpiresAt = new Date(now.getTime() + PLAY_WINDOW_MS);
  const registered = await registerWheelPhoneBoundSession({
    gameCatalogId: catalog.id,
    campaignKey: catalog.campaignKey,
    phone: input.phone,
    browserVisitorHash: visitor.visitorTokenHash,
    attemptId: input.attemptId.trim(),
    serverAssignment: assignment,
    playExpiresAt,
    now,
    env: input.env,
    db,
  });

  if (!registered.ok) {
    if (registered.error === "PHONE_ATTEMPT_EXISTS") {
      throwWheel(
        "WHEEL_ATTEMPT_EXISTS",
        "Этот номер уже участвовал в данной кампании",
        409,
      );
    }
    if (registered.error === "INVALID_INPUT") {
      throwWheel("GAME_INVALID_REQUEST", registered.message);
    }
    if (registered.error === "SECRET_UNAVAILABLE") {
      throwWheel("GAME_UNAVAILABLE", "Игра временно недоступна", 503);
    }
    if (registered.error === "RESULT_UNAVAILABLE") {
      throwWheel("RESULT_UNAVAILABLE", registered.message, 409);
    }
    throwWheel("GAME_UNAVAILABLE", registered.message, 409);
  }

  const storedAssignment = parseWheelServerAssignment(
    registered.session.serverAssignment,
  );
  if (!storedAssignment) {
    throwWheel("RESULT_UNAVAILABLE", "Результат игры временно недоступен", 409);
  }

  const animation = buildWheelPublicAnimationResult({
    sectorIndex: storedAssignment.sectorIndex,
    prizeDisplayName: prizeDisplayNameFromAssignment(storedAssignment),
    totalSectors: storedAssignment.totalSectors,
  });

  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const cookieOperations: CookieOperation[] = [
    ...visitor.cookieOperations,
    buildSessionSetOperation(
      cookieName,
      registered.session.sessionToken,
      new Date(registered.session.expiresAt),
      now,
    ),
  ];

  const response: WheelPublicStartResponse = {
    ok: true,
    status: "ACTIVE",
    expiresAt: registered.session.expiresAt,
    created: registered.session.created,
    animation,
  };
  assertSafeWheelPublicPayload(response);
  return {
    ...response,
    sessionToken: registered.session.sessionToken,
    cookieOperations,
  };
}

export async function getWheelPublicResult(input: {
  catalogSlug: string;
  auth: SessionAuthContext;
  now?: Date;
  db?: PrismaClient;
}): Promise<WheelPublicResultResponse & { cookieOperations: CookieOperation[] }> {
  const now = input.now ?? new Date();
  const db = input.db ?? defaultPrisma;
  const catalog = await loadWheelCatalogBySlug(input.catalogSlug, db);
  const visitor = ensureVisitorAuth(input.auth);
  const sessionToken = input.auth.sessionToken?.trim() || null;

  if (!sessionToken) {
    throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
  }

  const session = await db.gameSession.findFirst({
    where: {
      gameCatalogId: catalog.id,
      tokenHash: hashOpaqueToken(sessionToken),
    },
    select: {
      id: true,
      status: true,
      playExpiresAt: true,
      claimExpiresAt: true,
      browserVisitorHash: true,
      serverAssignment: true,
      gamePlay: {
        select: {
          id: true,
          leadId: true,
          giftSnapshot: true,
        },
      },
    },
  });

  if (!session) {
    throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
  }
  if (session.browserVisitorHash !== visitor.visitorTokenHash) {
    throwWheel("GAME_SESSION_FORBIDDEN", "Сессия недоступна", 403);
  }

  const status = mapSessionStatus(session.status, session.playExpiresAt, now);
  const assignment = parseWheelServerAssignment(session.serverAssignment);
  if (!assignment) {
    throwWheel("RESULT_UNAVAILABLE", "Результат игры временно недоступен", 409);
  }

  const snapshot = session.gamePlay?.giftSnapshot
    ? (parseGiftSnapshot(session.gamePlay.giftSnapshot) as WheelAwareGiftSnapshot | null)
    : null;
  const prizeDisplayName =
    snapshot?.finalPrize?.name?.trim() ||
    snapshot?.name?.trim() ||
    prizeDisplayNameFromAssignment(assignment);

  const animation = buildWheelPublicAnimationResult({
    sectorIndex: assignment.sectorIndex,
    prizeDisplayName,
    totalSectors: assignment.totalSectors,
  });

  const bookingSubmitted =
    status === "CONSUMED" || Boolean(session.gamePlay?.leadId);

  const expiresAt =
    status === "ACTIVE"
      ? session.playExpiresAt.toISOString()
      : (session.claimExpiresAt?.toISOString() ?? null);

  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const cookieOperations: CookieOperation[] = [
    ...visitor.cookieOperations,
    buildSessionSetOperation(
      cookieName,
      sessionToken,
      status === "ACTIVE"
        ? session.playExpiresAt
        : (session.claimExpiresAt ?? session.playExpiresAt),
      now,
    ),
  ];

  const response: WheelPublicResultResponse = {
    ok: true,
    status,
    expiresAt,
    hasResult: true,
    bookingSubmitted,
    animation,
    prizeDisplayName,
  };
  assertSafeWheelPublicPayload(response);
  return { ...response, cookieOperations };
}

function buildWheelManagerComment(input: {
  catalogTitle: string;
  interest: WheelPublicInterestKey;
  zone: string;
  originalName: string;
  finalName: string;
  replacementApplied: boolean;
}): string {
  const lines = [
    `Клиент прошёл игру «${input.catalogTitle}».`,
    "",
    `Интерес: ${WHEEL_PUBLIC_INTEREST_LABELS[input.interest]}`,
    `Зона: ${input.zone}`,
    `Исходный приз: ${input.originalName}`,
    `Итоговый приз: ${input.finalName}`,
  ];
  if (input.replacementApplied) {
    lines.push("Применена замена приза по подтверждённой зоне.");
  }
  return lines.join("\n");
}

function buildCompleteResponse(input: {
  bookingRequestId: string;
  giftSnapshot: WheelAwareGiftSnapshot;
  assignment: ReturnType<typeof parseWheelServerAssignment> & object;
}): WheelPublicCompleteResponse {
  const names = snapshotDisplayNames(input.giftSnapshot);
  const response: WheelPublicCompleteResponse = {
    ok: true,
    bookingRequestId: input.bookingRequestId,
    prizeDisplayName: names.finalName,
    originalPrizeDisplayName: names.originalName,
    replacementApplied: names.replacementApplied,
    bookingSubmitted: true,
  };
  assertSafeWheelPublicPayload(response);
  return response;
}

export async function completeWheelPublicGame(input: {
  catalogSlug: string;
  interest: unknown;
  confirmedZone?: unknown;
  name: string;
  phone: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
  auth: SessionAuthContext;
  request: Request;
  idempotencyKey: string;
  now?: Date;
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  /** Test injection for fake booking persistence. */
  createBookingRequestFn?: typeof createBookingRequest;
}): Promise<
  WheelPublicCompleteResponse & { cookieOperations: CookieOperation[] }
> {
  const now = input.now ?? new Date();
  const db = input.db ?? defaultPrisma;

  if (input.personalDataConsent !== true || input.offerAcknowledgement !== true) {
    throwWheel(
      "WHEEL_CONSENT_REQUIRED",
      "Необходимо принять обязательные согласия",
    );
  }
  if (!input.name.trim()) {
    throwWheel("GAME_INVALID_REQUEST", "Укажите имя");
  }
  if (!input.phone.trim()) {
    throwWheel("GAME_INVALID_REQUEST", "Укажите телефон");
  }
  if (!input.idempotencyKey.trim()) {
    throwWheel("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key обязателен");
  }

  const requestedInterest = mapToWheelInterestKey(input.interest);
  if (!requestedInterest) {
    throwWheel("GAME_INVALID_REQUEST", "Некорректный интерес");
  }

  // Catalog may become INACTIVE after start; persisted session remains source of truth.
  const catalog = await loadWheelCatalogBySlug(input.catalogSlug, db);
  const visitor = ensureVisitorAuth(input.auth);
  const sessionToken = input.auth.sessionToken?.trim() || null;
  if (!sessionToken) {
    throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
  }

  const sessionLookup = await db.gameSession.findFirst({
    where: {
      gameCatalogId: catalog.id,
      tokenHash: hashOpaqueToken(sessionToken),
    },
    select: { id: true },
  });
  if (!sessionLookup) {
    throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
  }

  const txResult = await db.$transaction(async (tx) => {
    await lockWheelSessionRow(tx, sessionLookup.id);

    const session = await tx.gameSession.findFirst({
      where: { id: sessionLookup.id },
      select: {
        id: true,
        gameCatalogId: true,
        status: true,
        playExpiresAt: true,
        claimExpiresAt: true,
        browserVisitorHash: true,
        participantPhoneHash: true,
        campaignKeySnapshot: true,
        serverAssignment: true,
        gamePlay: {
          select: {
            id: true,
            leadId: true,
            giftSnapshot: true,
            selectedGiftId: true,
          },
        },
      },
    });

    if (!session) {
      throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
    }
    if (session.browserVisitorHash !== visitor.visitorTokenHash) {
      throwWheel("GAME_SESSION_FORBIDDEN", "Сессия недоступна", 403);
    }

    const phoneCheck = assertWheelSessionPhoneMatches({
      participantPhoneHash: session.participantPhoneHash,
      campaignKeySnapshot: session.campaignKeySnapshot,
      gameCatalogId: session.gameCatalogId,
      phone: input.phone,
      env: input.env,
    });
    if (!phoneCheck.ok) {
      const status = phoneCheck.code === "GAME_SESSION_FORBIDDEN" ? 403 : 400;
      throwWheel(
        phoneCheck.code,
        phoneCheck.code === "GAME_SESSION_FORBIDDEN"
          ? "Сессия недоступна"
          : "Некорректный запрос",
        status,
      );
    }

    const assignment = parseWheelServerAssignment(session.serverAssignment);
    if (!assignment) {
      throwWheel("RESULT_UNAVAILABLE", "Результат игры временно недоступен", 409);
    }

    if (session.status === "EXPIRED") {
      throwWheel("GAME_SESSION_EXPIRED", "Время игры истекло", 409);
    }
    if (
      session.status === "ACTIVE" &&
      now.getTime() >= session.playExpiresAt.getTime()
    ) {
      await tx.gameSession.updateMany({
        where: { id: session.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      throwWheel("GAME_SESSION_EXPIRED", "Время игры истекло", 409);
    }

    const existingSnapshot = session.gamePlay?.giftSnapshot
      ? (parseGiftSnapshot(
          session.gamePlay.giftSnapshot,
        ) as WheelAwareGiftSnapshot | null)
      : null;

    if (session.status === "CONSUMED" && session.gamePlay?.leadId) {
      const booking = await tx.bookingRequest.findUnique({
        where: { id: session.gamePlay.leadId },
        select: { id: true },
      });
      if (!booking) {
        throwWheel("RESULT_UNAVAILABLE", "Заявка недоступна", 409);
      }
      return {
        kind: "already_consumed" as const,
        bookingRequestId: booking.id,
        giftSnapshot:
          existingSnapshot ??
          ({
            giftId: assignment.giftId,
            name: prizeDisplayNameFromAssignment(assignment),
            shortDescription: "",
            image: null,
            priority: "standard",
            cardStyle: "default",
            ruleType: "wheel_sector",
            assignedValue: null,
            assignedAt: now.toISOString(),
            activationMode: "SINGLE_PAID_SERVICE",
            minCourseSessions: null,
            activationConditionText: "",
            validityDays: 30,
            originalPrize: {
              name: prizeDisplayNameFromAssignment(assignment),
              giftId: assignment.giftId,
              systemKey: assignment.prizeSystemKey,
            },
            finalPrize: {
              name: prizeDisplayNameFromAssignment(assignment),
              giftId: assignment.giftId,
              systemKey: assignment.prizeSystemKey,
            },
          } as unknown as WheelAwareGiftSnapshot),
        assignment,
      };
    }

    const effectiveInterest = resolveLockedInterest(
      existingSnapshot,
      requestedInterest,
    );
    const effectiveZone = validateClaimZoneForInterest({
      interest: effectiveInterest,
      confirmedZone:
        existingSnapshot?.confirmedZone ?? input.confirmedZone,
    });
    if (!effectiveZone.ok) {
      throwWheel("GAME_INVALID_REQUEST", effectiveZone.error);
    }

    let giftSnapshot: WheelAwareGiftSnapshot;
    let selectedGiftId: string;

    if (existingSnapshot?.confirmedInterest) {
      giftSnapshot = existingSnapshot;
      selectedGiftId =
        session.gamePlay?.selectedGiftId ??
        existingSnapshot.finalPrize?.giftId ??
        assignment.giftId;
    } else {
      const built = buildWheelCompleteGiftSnapshot({
        assignment,
        confirmedInterest: effectiveInterest,
        confirmedZone: effectiveZone.confirmedZone,
        now,
      });
      if (!built.ok) {
        throwWheel("RESULT_UNAVAILABLE", built.error, 409);
      }
      giftSnapshot = built.giftSnapshot;
      selectedGiftId = built.selectedGiftId;
    }

    const rulesSnapshot = buildRulesSnapshot({
      campaignKey: assignment.campaignKey,
      rulesVersion: assignment.rulesVersion,
      mechanicType: "WHEEL_OF_FORTUNE",
      serverResultTier: 0,
      catalogSlug: catalog.slug,
      catalogTitle: catalog.title,
      bookingWindowHours: BOOKING_WINDOW_HOURS,
    });

    const claimExpiresAt = new Date(now.getTime() + CLAIM_WINDOW_MS);

    let gamePlayId = session.gamePlay?.id ?? null;
    if (!gamePlayId) {
      try {
        const play = await tx.gamePlay.create({
          data: {
            gameDirection: "wheel",
            skinNeed: "none",
            resultType: "wheel",
            premiumLevel: 0,
            gameCatalogId: catalog.id,
            gameSessionId: session.id,
            selectedGiftId,
            serverResultTier: 0,
            campaignKey: assignment.campaignKey,
            giftSnapshot: giftSnapshot as unknown as Prisma.InputJsonValue,
            rulesSnapshot: rulesSnapshot as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        gamePlayId = play.id;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existingPlay = await tx.gamePlay.findUnique({
            where: { gameSessionId: session.id },
            select: {
              id: true,
              leadId: true,
              giftSnapshot: true,
              selectedGiftId: true,
            },
          });
          if (!existingPlay) {
            throw error;
          }
          gamePlayId = existingPlay.id;
          if (existingPlay.leadId) {
            const booking = await tx.bookingRequest.findUnique({
              where: { id: existingPlay.leadId },
              select: { id: true },
            });
            if (!booking) {
              throwWheel("RESULT_UNAVAILABLE", "Заявка недоступна", 409);
            }
            const racedSnapshot = existingPlay.giftSnapshot
              ? (parseGiftSnapshot(
                  existingPlay.giftSnapshot,
                ) as WheelAwareGiftSnapshot | null)
              : giftSnapshot;
            return {
              kind: "already_consumed" as const,
              bookingRequestId: booking.id,
              giftSnapshot: racedSnapshot ?? giftSnapshot,
              assignment,
            };
          }
          const racedSnapshot = existingPlay.giftSnapshot
            ? (parseGiftSnapshot(
                existingPlay.giftSnapshot,
              ) as WheelAwareGiftSnapshot | null)
            : null;
          if (racedSnapshot?.confirmedInterest) {
            giftSnapshot = racedSnapshot;
            selectedGiftId =
              existingPlay.selectedGiftId ??
              racedSnapshot.finalPrize?.giftId ??
              assignment.giftId;
          }
        } else {
          throw error;
        }
      }
    } else if (!session.gamePlay?.leadId && !existingSnapshot?.confirmedInterest) {
      await tx.gamePlay.updateMany({
        where: {
          id: gamePlayId,
          leadId: null,
        },
        data: {
          giftSnapshot: giftSnapshot as unknown as Prisma.InputJsonValue,
          selectedGiftId,
          rulesSnapshot: rulesSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await tx.gameSession.updateMany({
      where: {
        id: session.id,
        status: { in: ["ACTIVE", "COMPLETED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: now,
        claimExpiresAt,
      },
    });

    const publicInterest = wheelInterestToPublicKey(effectiveInterest);
    const names = snapshotDisplayNames(giftSnapshot);
    const comment = buildWheelManagerComment({
      catalogTitle: catalog.title,
      interest: publicInterest,
      zone: effectiveZone.confirmedZone,
      originalName: names.originalName,
      finalName: names.finalName,
      replacementApplied: names.replacementApplied,
    });

    const bookingFn = input.createBookingRequestFn ?? createBookingRequest;
    const booking = await bookingFn({
      clientName: input.name.trim(),
      clientPhone: phoneCheck.bookingPhone,
      comment,
      type: "CONSULTATION_REQUEST",
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: gamePlayId!,
      idempotencyKey: input.idempotencyKey.trim(),
      request: input.request,
      db: tx,
    });

    return {
      kind: "created" as const,
      bookingRequestId: booking.id,
      giftSnapshot,
      assignment,
      claimExpiresAt,
    };
  });

  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const claimExpiresAt =
    txResult.kind === "created"
      ? txResult.claimExpiresAt
      : new Date(now.getTime() + CLAIM_WINDOW_MS);
  const cookieOperations: CookieOperation[] = [
    ...visitor.cookieOperations,
    buildSessionSetOperation(
      cookieName,
      sessionToken,
      claimExpiresAt,
      now,
    ),
  ];

  const response = buildCompleteResponse({
    bookingRequestId: txResult.bookingRequestId,
    giftSnapshot: txResult.giftSnapshot,
    assignment: txResult.assignment,
  });
  return { ...response, cookieOperations };
}
