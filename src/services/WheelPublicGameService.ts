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
import { resolvePrizeReplacement } from "@/lib/game/wheel/prize-replacement";
import { parsePrizeRules } from "@/lib/game/wheel/prize-rules-contract";
import { isGamePrizeType } from "@/lib/game/wheel/prize-types";
import {
  mapToWheelInterestKey,
  wheelInterestToPublicKey,
  WHEEL_PUBLIC_INTEREST_LABELS,
  type WheelPublicInterestKey,
} from "@/lib/game/wheel/public-interest";
import { registerWheelPhoneBoundSession } from "@/lib/game/wheel/register-phone-bound-session";
import { giftsToSectorGifts, assertWheelCatalogReadyForActivation } from "@/lib/game/wheel/wheel-admin";
import { buildWheelServerAssignment } from "@/lib/game/wheel/wheel-assignment";
import { completeWheelFromServerAssignment } from "@/lib/game/wheel/wheel-complete";
import {
  applyReplacementToWheelGiftSnapshot,
  type WheelAwareGiftSnapshot,
} from "@/lib/game/wheel/wheel-gift-snapshot";
import { buildPublicSectorLabels } from "@/lib/game/wheel/wheel-public-labels";
import {
  assertSafeWheelPublicPayload,
  buildWheelPublicAnimationResult,
  type WheelPublicCompleteResponse,
  type WheelPublicResultResponse,
  type WheelPublicSessionStatus,
  type WheelPublicStartResponse,
} from "@/lib/game/wheel/wheel-public-dto";
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

async function loadSectorGifts(catalogId: string, db: PrismaClient) {
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

function giftDisplayName(
  gifts: Array<{ id: string; name: string }>,
  giftId: string,
): string {
  return gifts.find((gift) => gift.id === giftId)?.name?.trim() || "Приз";
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
  /** Test override — skips StudioSettings lookup when provided. */
  isGameEnabled?: boolean;
}): Promise<WheelPublicStartResponse & { cookieOperations: CookieOperation[] }> {
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
  const assignment = buildWheelServerAssignment({
    catalogCampaignKey: catalog.campaignKey,
    catalogRulesVersion: catalog.rulesVersion,
    settingsRaw: catalog.settings,
    gifts: giftsToSectorGifts(gifts),
    now,
  });
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
    prizeDisplayName: giftDisplayName(gifts, storedAssignment.giftId),
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
    sessionToken: registered.session.sessionToken,
    animation,
  };
  assertSafeWheelPublicPayload(response);
  return { ...response, cookieOperations };
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

  const gifts = await loadSectorGifts(catalog.id, db);
  const snapshot = parseGiftSnapshot(session.gamePlay?.giftSnapshot ?? null);
  const prizeDisplayName =
    snapshot?.name?.trim() || giftDisplayName(gifts, assignment.giftId);

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
    gamePlayId: session.gamePlay?.id ?? null,
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

  const interest = mapToWheelInterestKey(input.interest);
  if (!interest) {
    throwWheel("GAME_INVALID_REQUEST", "Некорректный интерес");
  }
  const zoneValidation = validateClaimZoneForInterest({
    interest,
    confirmedZone: input.confirmedZone,
  });
  if (!zoneValidation.ok) {
    throwWheel("GAME_INVALID_REQUEST", zoneValidation.error);
  }

  // Catalog may become INACTIVE after start; persisted session remains source of truth.
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
    await db.gameSession.updateMany({
      where: { id: session.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    throwWheel("GAME_SESSION_EXPIRED", "Время игры истекло", 409);
  }

  const gifts = await loadSectorGifts(catalog.id, db);
  const existingSnapshot = session.gamePlay?.giftSnapshot
    ? (parseGiftSnapshot(
        session.gamePlay.giftSnapshot,
      ) as WheelAwareGiftSnapshot | null)
    : null;

  if (session.status === "CONSUMED" && session.gamePlay?.leadId) {
    const booking = await db.bookingRequest.findUnique({
      where: { id: session.gamePlay.leadId },
      select: { id: true },
    });
    if (!booking) {
      throwWheel("RESULT_UNAVAILABLE", "Заявка недоступна", 409);
    }
    const originalName =
      existingSnapshot?.originalPrize?.name ||
      existingSnapshot?.name ||
      giftDisplayName(gifts, assignment.giftId);
    const finalName =
      existingSnapshot?.finalPrize?.name ||
      existingSnapshot?.name ||
      originalName;
    const response: WheelPublicCompleteResponse = {
      ok: true,
      bookingRequestId: booking.id,
      prizeDisplayName: finalName,
      originalPrizeDisplayName: originalName,
      replacementApplied: Boolean(existingSnapshot?.replacementApplied),
      bookingSubmitted: true,
    };
    assertSafeWheelPublicPayload(response);
    return { ...response, cookieOperations: visitor.cookieOperations };
  }

  const lockedInterest = existingSnapshot?.confirmedInterest ?? null;
  const effectiveInterest = lockedInterest ?? interest;
  const effectiveZone = lockedInterest
    ? validateClaimZoneForInterest({
        interest: lockedInterest,
        confirmedZone: existingSnapshot?.confirmedZone ?? input.confirmedZone,
      })
    : zoneValidation;
  if (!effectiveZone.ok) {
    throwWheel("GAME_INVALID_REQUEST", effectiveZone.error);
  }

  const completeBase = completeWheelFromServerAssignment({
    assignment,
    gifts: gifts.map((gift) => ({
      id: gift.id,
      name: gift.name,
      shortDescription: gift.shortDescription,
      image: gift.image,
      priority: gift.priority,
      cardStyle: gift.cardStyle,
      activationMode: gift.activationMode,
      minCourseSessions: gift.minCourseSessions,
      activationConditionText: gift.activationConditionText,
      systemKey: gift.systemKey,
      prizeType: gift.prizeType,
      prizeRules: gift.prizeRules,
    })),
    existingGiftSnapshot: null,
    clientBody: {},
    now,
  });
  if (!completeBase.ok) {
    throwWheel("RESULT_UNAVAILABLE", completeBase.error, 409);
  }

  let giftSnapshot = completeBase.giftSnapshot as WheelAwareGiftSnapshot;
  const originalRules = parsePrizeRules(giftSnapshot.prizeRules);
  if (!originalRules || !isGamePrizeType(giftSnapshot.prizeType)) {
    throwWheel("RESULT_UNAVAILABLE", "Правила приза недоступны", 409);
  }

  const fallbackKey = originalRules.replacement?.fallbackSystemKey ?? null;
  const fallbackGift = fallbackKey
    ? (gifts.find((gift) => gift.systemKey === fallbackKey) ?? null)
    : null;

  const replacement = resolvePrizeReplacement({
    original: {
      systemKey: assignment.prizeSystemKey,
      giftId: assignment.giftId,
      name: giftDisplayName(gifts, assignment.giftId),
    },
    originalRules,
    confirmedInterest: effectiveInterest,
    confirmedZone: effectiveZone.confirmedZone,
    fallbackPrize: fallbackGift
      ? {
          systemKey: fallbackGift.systemKey ?? fallbackGift.id,
          giftId: fallbackGift.id,
          name: fallbackGift.name,
        }
      : null,
    now,
  });

  let selectedGiftId = assignment.giftId;
  if (replacement.replaced) {
    const finalGift = gifts.find((gift) => gift.id === replacement.final.giftId);
    if (!finalGift) {
      throwWheel("RESULT_UNAVAILABLE", "Приз замены недоступен", 409);
    }
    const finalRules = parsePrizeRules(finalGift.prizeRules);
    const finalType = isGamePrizeType(finalGift.prizeType)
      ? finalGift.prizeType
      : null;
    if (!finalRules || !finalType) {
      throwWheel("RESULT_UNAVAILABLE", "Правила приза замены недоступны", 409);
    }
    giftSnapshot = applyReplacementToWheelGiftSnapshot(giftSnapshot, {
      finalPrize: replacement.final,
      finalPrizeType: finalType,
      finalPrizeRules: finalRules,
      confirmedInterest: replacement.confirmedInterest,
      confirmedZone: replacement.confirmedZone,
      replacementReason: replacement.replacementReason,
      replacedAt: replacement.replacedAt,
    });
    selectedGiftId = replacement.final.giftId;
  } else {
    giftSnapshot = {
      ...giftSnapshot,
      confirmedInterest: effectiveInterest,
      confirmedZone: effectiveZone.confirmedZone,
      originalPrize: giftSnapshot.originalPrize ?? {
        systemKey: assignment.prizeSystemKey,
        giftId: assignment.giftId,
        name: giftDisplayName(gifts, assignment.giftId),
      },
      finalPrize: giftSnapshot.finalPrize ?? {
        systemKey: assignment.prizeSystemKey,
        giftId: assignment.giftId,
        name: giftDisplayName(gifts, assignment.giftId),
      },
    };
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

  const gamePlayId = await db.$transaction(async (tx) => {
    const locked = await tx.gameSession.findFirst({
      where: { id: session.id },
      select: {
        id: true,
        status: true,
        gamePlay: { select: { id: true, leadId: true } },
      },
    });
    if (!locked) {
      throwWheel("GAME_SESSION_NOT_FOUND", "Игровая сессия не найдена", 404);
    }
    if (locked.gamePlay?.leadId) {
      return locked.gamePlay.id;
    }
    if (locked.gamePlay?.id) {
      await tx.gamePlay.update({
        where: { id: locked.gamePlay.id },
        data: {
          giftSnapshot: giftSnapshot as unknown as Prisma.InputJsonValue,
          selectedGiftId,
          rulesSnapshot: rulesSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
      if (locked.status === "ACTIVE") {
        await tx.gameSession.updateMany({
          where: { id: locked.id, status: "ACTIVE" },
          data: {
            status: "COMPLETED",
            completedAt: now,
            claimExpiresAt,
          },
        });
      }
      return locked.gamePlay.id;
    }

    const play = await tx.gamePlay.create({
      data: {
        gameDirection: "wheel",
        skinNeed: "none",
        resultType: "wheel",
        premiumLevel: 0,
        gameCatalogId: catalog.id,
        gameSessionId: locked.id,
        selectedGiftId,
        serverResultTier: 0,
        campaignKey: assignment.campaignKey,
        giftSnapshot: giftSnapshot as unknown as Prisma.InputJsonValue,
        rulesSnapshot: rulesSnapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await tx.gameSession.updateMany({
      where: { id: locked.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      data: {
        status: "COMPLETED",
        completedAt: now,
        claimExpiresAt,
      },
    });
    return play.id;
  });

  const publicInterest = wheelInterestToPublicKey(effectiveInterest);
  const comment = buildWheelManagerComment({
    catalogTitle: catalog.title,
    interest: publicInterest,
    zone: effectiveZone.confirmedZone,
    originalName:
      giftSnapshot.originalPrize?.name ||
      giftDisplayName(gifts, assignment.giftId),
    finalName: giftSnapshot.finalPrize?.name || giftSnapshot.name || "Приз",
    replacementApplied: Boolean(giftSnapshot.replacementApplied),
  });

  const cookieName = buildCatalogSessionCookieName(catalog.slug);
  const cookieOperations: CookieOperation[] = [
    ...visitor.cookieOperations,
    buildSessionSetOperation(cookieName, sessionToken, claimExpiresAt, now),
  ];

  const booking = await createBookingRequest({
    clientName: input.name.trim(),
    clientPhone: input.phone.trim(),
    comment,
    type: "CONSULTATION_REQUEST",
    personalDataConsent: true,
    offerAcknowledgement: true,
    gamePlayId,
    idempotencyKey: input.idempotencyKey.trim(),
    request: input.request,
  });

  const response: WheelPublicCompleteResponse = {
    ok: true,
    bookingRequestId: booking.id,
    prizeDisplayName:
      giftSnapshot.finalPrize?.name || giftSnapshot.name || "Приз",
    originalPrizeDisplayName:
      giftSnapshot.originalPrize?.name ||
      giftDisplayName(gifts, assignment.giftId),
    replacementApplied: Boolean(giftSnapshot.replacementApplied),
    bookingSubmitted: true,
  };
  assertSafeWheelPublicPayload(response);
  return { ...response, cookieOperations };
}
