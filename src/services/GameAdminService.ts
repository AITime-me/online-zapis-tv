import { Prisma, type GamePrizeType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertCreateGiftCatalogId,
  assertGiftBelongsToCatalog,
  GAME_GIFT_CATALOG_NOT_FOUND_ERROR,
  rejectClientCatalogRebind,
} from "@/lib/game/admin-gift-catalog-binding";
import {
  assertFutureWheelSectorConfig,
  assertWheelGiftIdentityImmutable,
  assertWheelGiftUpdateAllowlist,
  isWheelIdentityGift,
  serverAssignmentReferencesGiftId,
} from "@/lib/game/admin-gift-update-policy";
import {
  generateActivationConditionText,
  validateGiftActivationInput,
  type GameGiftActivationMode,
} from "@/lib/game/gift-activation";
import {
  buildWheelCatalogConfigDto,
  ensureDefaultWheelPrizes,
  giftsToSectorGifts,
  mapPrizeRulesJson,
  normalizePrizeRulesInput,
  normalizePrizeType,
  normalizeSystemKey,
} from "@/lib/game/wheel/wheel-admin";
import { parsePrizeRules } from "@/lib/game/wheel/prize-rules-contract";
import { WHEEL_DEFAULT_SECTOR_COUNT } from "@/lib/game/wheel/default-prizes";
import { resolveWheelSettingsFromCatalogSettings } from "@/lib/game/wheel/wheel-settings";
import type {
  GameConfigDto,
  GameConfigWriteInput,
  GameGiftDto,
  GameGiftWriteInput,
  WheelCatalogConfigDto,
} from "@/types/game-admin";
import type { GameCatalogStatusDto } from "@/types/game-catalog";
import { syncCatchTimeCatalogFromLegacyConfig } from "@/services/GameCatalogService";

export class GameAdminValidationError extends Error {}
export class GameAdminNotFoundError extends Error {}

const DEFAULT_CONFIG_ID = "default";

function mapConfig(row: Awaited<ReturnType<typeof prisma.gameConfig.findUnique>>): GameConfigDto {
  if (!row) {
    throw new GameAdminNotFoundError("Конфигурация игры не найдена");
  }

  return {
    id: row.id,
    isActive: row.isActive,
    title: row.title,
    description: row.description,
    image: row.image ?? null,
    resultHeaderText: row.resultHeaderText,
    directionLabelText: row.directionLabelText,
    giftLabelText: row.giftLabelText,
    ctaButtonText: row.ctaButtonText,
    ctaButtonLink: row.ctaButtonLink,
    managerMessageHeader: row.managerMessageHeader,
    managerMessageFooter: row.managerMessageFooter,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapGift(row: {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  isActive: boolean;
  probability: number;
  priority: string;
  cardStyle: string;
  allowedGameDirections: string[];
  allowedResultTypes: string[];
  requiredPremiumLevel: number;
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
  systemKey: string | null;
  prizeType: GamePrizeType | null;
  prizeRules: Prisma.JsonValue | null;
  sortOrder: number;
  gameCatalogId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GameGiftDto {
  return {
    id: row.id,
    name: row.name,
    shortDescription: row.shortDescription,
    image: row.image ?? null,
    isActive: row.isActive,
    probability: row.probability,
    priority: row.priority,
    cardStyle: row.cardStyle,
    allowedGameDirections: [...row.allowedGameDirections],
    allowedResultTypes: [...row.allowedResultTypes],
    requiredPremiumLevel: row.requiredPremiumLevel,
    activationMode: row.activationMode,
    minCourseSessions: row.minCourseSessions,
    activationConditionText: row.activationConditionText,
    systemKey: row.systemKey ?? null,
    prizeType: row.prizeType ?? null,
    prizeRules: mapPrizeRulesJson(row.prizeRules),
    sortOrder: row.sortOrder ?? 0,
    gameCatalogId: row.gameCatalogId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireGameCatalogId(gameCatalogId: string): Promise<string> {
  let catalogId: string;
  try {
    catalogId = assertCreateGiftCatalogId(gameCatalogId);
  } catch (error) {
    throw new GameAdminValidationError(
      error instanceof Error ? error.message : GAME_GIFT_CATALOG_NOT_FOUND_ERROR,
    );
  }

  const catalog = await prisma.gameCatalog.findUnique({
    where: { id: catalogId },
    select: { id: true },
  });
  if (!catalog) {
    throw new GameAdminNotFoundError(GAME_GIFT_CATALOG_NOT_FOUND_ERROR);
  }
  return catalog.id;
}

export async function getGameAdminPageData(gameCatalogId: string): Promise<{
  config: GameConfigDto;
  gifts: GameGiftDto[];
  gameCatalogId: string;
}> {
  const catalogId = await requireGameCatalogId(gameCatalogId);

  const [configRow, gifts] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } }),
    prisma.gameGift.findMany({
      where: { gameCatalogId: catalogId },
      orderBy: [{ isActive: "desc" }, { probability: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  return {
    config: mapConfig(configRow),
    gifts: gifts.map(mapGift),
    gameCatalogId: catalogId,
  };
}

function mapWheelAdminStatusDto(
  status: "DRAFT" | "ACTIVE" | "DISABLED" | "ARCHIVED",
): GameCatalogStatusDto {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "DISABLED":
      return "disabled";
    case "ARCHIVED":
      return "archived";
    default:
      return "draft";
  }
}

export async function getWheelAdminPageData(gameCatalogId: string): Promise<{
  gifts: GameGiftDto[];
  wheelConfig: WheelCatalogConfigDto;
  gameCatalogId: string;
  title: string;
  slug: string;
  description: string | null;
  status: GameCatalogStatusDto;
  showOnHomepage: boolean;
}> {
  const catalogId = await requireGameCatalogId(gameCatalogId);
  const catalog = await prisma.gameCatalog.findUnique({
    where: { id: catalogId },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      status: true,
      type: true,
      settings: true,
      showOnHomepage: true,
    },
  });
  if (!catalog || catalog.type !== "WHEEL_OF_FORTUNE") {
    throw new GameAdminNotFoundError("Каталог колеса фортуны не найден");
  }

  const gifts = await prisma.gameGift.findMany({
    where: { gameCatalogId: catalogId },
    orderBy: [{ sortOrder: "asc" }, { probability: "desc" }, { createdAt: "asc" }],
  });
  const mapped = gifts.map(mapGift);

  return {
    gifts: mapped,
    wheelConfig: buildWheelCatalogConfigDto(
      catalog.settings,
      giftsToSectorGifts(mapped),
    ),
    gameCatalogId: catalogId,
    title: catalog.title,
    slug: catalog.slug,
    description: catalog.description,
    status: mapWheelAdminStatusDto(catalog.status),
    showOnHomepage: catalog.showOnHomepage,
  };
}

export async function seedDefaultWheelPrizesForCatalog(
  gameCatalogId: string,
): Promise<{ created: number; skipped: number; wheelConfig: WheelCatalogConfigDto; gifts: GameGiftDto[] }> {
  const catalogId = await requireGameCatalogId(gameCatalogId);
  let seeded: { created: number; skipped: number };
  try {
    seeded = await ensureDefaultWheelPrizes(catalogId);
  } catch (error) {
    throw new GameAdminValidationError(
      error instanceof Error ? error.message : "Не удалось создать призы по умолчанию",
    );
  }
  const data = await getWheelAdminPageData(catalogId);
  return {
    created: seeded.created,
    skipped: seeded.skipped,
    wheelConfig: data.wheelConfig,
    gifts: data.gifts,
  };
}

export async function updateGameConfig(
  input: GameConfigWriteInput,
): Promise<GameConfigDto> {
  const existing = await prisma.gameConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
  });

  if (!existing) {
    throw new GameAdminNotFoundError("Конфигурация игры не найдена");
  }

  const title = input.title?.trim();
  if (title !== undefined && !title) {
    throw new GameAdminValidationError("Название игры не может быть пустым");
  }

  const ctaButtonLink = input.ctaButtonLink?.trim();
  if (ctaButtonLink !== undefined && !ctaButtonLink.startsWith("/")) {
    throw new GameAdminValidationError("Ссылка кнопки должна начинаться с /");
  }

  const updated = await prisma.gameConfig.update({
    where: { id: DEFAULT_CONFIG_ID },
    data: {
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image !== undefined ? { image: input.image || null } : {}),
      ...(input.resultHeaderText !== undefined
        ? { resultHeaderText: input.resultHeaderText }
        : {}),
      ...(input.directionLabelText !== undefined
        ? { directionLabelText: input.directionLabelText }
        : {}),
      ...(input.giftLabelText !== undefined ? { giftLabelText: input.giftLabelText } : {}),
      ...(input.ctaButtonText !== undefined ? { ctaButtonText: input.ctaButtonText } : {}),
      ...(ctaButtonLink !== undefined ? { ctaButtonLink } : {}),
      ...(input.managerMessageHeader !== undefined
        ? { managerMessageHeader: input.managerMessageHeader }
        : {}),
      ...(input.managerMessageFooter !== undefined
        ? { managerMessageFooter: input.managerMessageFooter }
        : {}),
    },
  });

  await syncCatchTimeCatalogFromLegacyConfig();

  return mapConfig(updated);
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function parseNonNegativeIntStrict(value: unknown, errorMessage: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new GameAdminValidationError(errorMessage);
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new GameAdminValidationError(errorMessage);
    }
    return Number(trimmed);
  }
  throw new GameAdminValidationError(errorMessage);
}

function wrapBindingError(error: unknown): never {
  if (error instanceof GameAdminValidationError || error instanceof GameAdminNotFoundError) {
    throw error;
  }
  throw new GameAdminValidationError(
    error instanceof Error ? error.message : "Ошибка привязки подарка к каталогу",
  );
}

export async function createGameGift(
  gameCatalogId: string,
  input: GameGiftWriteInput,
): Promise<GameGiftDto> {
  const catalogId = await requireGameCatalogId(gameCatalogId);
  try {
    rejectClientCatalogRebind(
      (input as { gameCatalogId?: unknown }).gameCatalogId,
      catalogId,
    );
  } catch (error) {
    wrapBindingError(error);
  }

  const name = input.name.trim();
  const shortDescription = input.shortDescription.trim();
  if (!name) {
    throw new GameAdminValidationError("Название подарка не может быть пустым");
  }
  if (!shortDescription) {
    throw new GameAdminValidationError("Описание подарка не может быть пустым");
  }

  const probability = Math.max(0, toInt(input.probability, 0));
  const requiredPremiumLevel = Math.max(0, toInt(input.requiredPremiumLevel, 0));
  const sortOrder = Math.max(0, toInt(input.sortOrder, 0));

  let systemKey: string | null = null;
  let prizeType: GamePrizeType | null = null;
  let prizeRules: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    undefined;
  try {
    systemKey = normalizeSystemKey(input.systemKey);
    prizeType = normalizePrizeType(input.prizeType);
    prizeRules = normalizePrizeRulesInput(input.prizeRules);
  } catch (error) {
    throw new GameAdminValidationError(
      error instanceof Error ? error.message : "Некорректные поля приза",
    );
  }

  const activation = validateGiftActivationInput({
    activationMode: input.activationMode ?? "SINGLE_PAID_SERVICE",
    minCourseSessions: input.minCourseSessions,
    activationConditionText: input.activationConditionText,
  });
  if (!activation.ok) {
    throw new GameAdminValidationError(activation.error);
  }

  const created = await prisma.gameGift.create({
    data: {
      name,
      shortDescription,
      image: input.image ?? null,
      isActive: input.isActive ?? true,
      probability,
      priority: input.priority ?? "standard",
      cardStyle: input.cardStyle ?? "default",
      allowedGameDirections: normalizeStrings(input.allowedGameDirections),
      allowedResultTypes: normalizeStrings(input.allowedResultTypes),
      requiredPremiumLevel,
      activationMode: activation.value.activationMode,
      minCourseSessions: activation.value.minCourseSessions,
      activationConditionText: activation.value.activationConditionText,
      systemKey,
      prizeType,
      ...(prizeRules !== undefined ? { prizeRules } : {}),
      sortOrder,
      gameCatalogId: catalogId,
    },
  });

  return mapGift(created);
}

export async function updateGameGift(
  gameCatalogId: string,
  id: string,
  input: Partial<GameGiftWriteInput>,
): Promise<GameGiftDto> {
  const catalogId = await requireGameCatalogId(gameCatalogId);
  try {
    rejectClientCatalogRebind(
      (input as { gameCatalogId?: unknown }).gameCatalogId,
      catalogId,
    );
  } catch (error) {
    wrapBindingError(error);
  }

  const existing = await prisma.gameGift.findUnique({ where: { id } });
  if (!existing) {
    throw new GameAdminNotFoundError("Подарок не найден");
  }

  try {
    assertGiftBelongsToCatalog({
      giftCatalogId: existing.gameCatalogId,
      expectedCatalogId: catalogId,
    });
  } catch (error) {
    wrapBindingError(error);
  }

  if (isWheelIdentityGift(existing)) {
    try {
      assertWheelGiftUpdateAllowlist({
        existing: {
          image: existing.image,
          priority: existing.priority,
          cardStyle: existing.cardStyle,
          allowedGameDirections: existing.allowedGameDirections,
          allowedResultTypes: existing.allowedResultTypes,
          requiredPremiumLevel: existing.requiredPremiumLevel,
          activationMode: existing.activationMode,
          minCourseSessions: existing.minCourseSessions,
          sortOrder: existing.sortOrder,
        },
        patch: input as Record<string, unknown>,
      });
      assertWheelGiftIdentityImmutable({
        existing: {
          systemKey: existing.systemKey,
          prizeType: existing.prizeType,
          prizeRules: existing.prizeRules,
        },
        patch: {
          systemKey: input.systemKey,
          prizeType: input.prizeType,
          prizeRules: input.prizeRules,
        },
      });
    } catch (error) {
      throw new GameAdminValidationError(
        error instanceof Error ? error.message : "Некорректные поля приза",
      );
    }
  }

  const name = input.name?.trim();
  const shortDescription = input.shortDescription?.trim();
  if (name !== undefined && !name) {
    throw new GameAdminValidationError("Название подарка не может быть пустым");
  }
  if (shortDescription !== undefined && !shortDescription) {
    throw new GameAdminValidationError("Описание подарка не может быть пустым");
  }

  let nextProbability: number | undefined;
  if (input.probability !== undefined) {
    nextProbability = parseNonNegativeIntStrict(
      input.probability,
      "Количество секторов должно быть целым неотрицательным числом",
    );
  }

  const nextMode =
    input.activationMode !== undefined
      ? input.activationMode
      : existing.activationMode;
  const nextMin =
    input.minCourseSessions !== undefined
      ? input.minCourseSessions
      : existing.minCourseSessions;
  const nextConditionText =
    input.activationConditionText !== undefined
      ? input.activationConditionText
      : existing.activationConditionText;

  const activationTouched =
    input.activationMode !== undefined ||
    input.minCourseSessions !== undefined ||
    input.activationConditionText !== undefined;

  let activationMode = existing.activationMode;
  let minCourseSessions = existing.minCourseSessions;
  let activationConditionText = existing.activationConditionText;

  if (activationTouched) {
    const activation = validateGiftActivationInput({
      activationMode: nextMode,
      minCourseSessions: nextMin,
      activationConditionText: nextConditionText,
    });
    if (!activation.ok) {
      throw new GameAdminValidationError(activation.error);
    }
    activationMode = activation.value.activationMode;
    minCourseSessions = activation.value.minCourseSessions;
    activationConditionText = activation.value.activationConditionText;
  } else if (!activationConditionText.trim()) {
    activationConditionText = generateActivationConditionText(
      activationMode,
      minCourseSessions,
    );
  }

  let nextSystemKey: string | null | undefined;
  let nextPrizeType: GamePrizeType | null | undefined;
  let nextPrizeRules: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
  let nextSortOrder: number | undefined;
  try {
    if (!isWheelIdentityGift(existing)) {
      if (input.systemKey !== undefined) {
        nextSystemKey = normalizeSystemKey(input.systemKey);
        if (nextSystemKey !== existing.systemKey) {
          throw new GameAdminValidationError(
            "systemKey нельзя изменить у существующего подарка",
          );
        }
        nextSystemKey = undefined;
      }
      if (input.prizeType !== undefined) {
        nextPrizeType = normalizePrizeType(input.prizeType);
        if (nextPrizeType !== existing.prizeType) {
          throw new GameAdminValidationError(
            "Тип приза нельзя изменить. Создайте новый подарок и отключите текущий.",
          );
        }
        nextPrizeType = undefined;
      }
      if (input.prizeRules !== undefined) {
        const existingParsed = parsePrizeRules(existing.prizeRules);
        const nextParsed = parsePrizeRules(input.prizeRules);
        if (JSON.stringify(nextParsed) !== JSON.stringify(existingParsed)) {
          throw new GameAdminValidationError(
            "prizeRules нельзя изменить через обычное редактирование",
          );
        }
        nextPrizeRules = undefined;
      }
      if (input.sortOrder !== undefined) {
        nextSortOrder = Math.max(0, toInt(input.sortOrder, existing.sortOrder ?? 0));
      }
    } else {
      nextSystemKey = undefined;
      nextPrizeType = undefined;
      nextPrizeRules = undefined;
      nextSortOrder = undefined;
    }
  } catch (error) {
    if (error instanceof GameAdminValidationError) {
      throw error;
    }
    throw new GameAdminValidationError(
      error instanceof Error ? error.message : "Некорректные поля приза",
    );
  }

  const wheelLocked = isWheelIdentityGift(existing);
  const nextIsActive =
    input.isActive !== undefined ? input.isActive : existing.isActive;
  const resolvedProbability =
    nextProbability !== undefined ? nextProbability : existing.probability;

  if (
    wheelLocked &&
    (input.probability !== undefined || input.isActive !== undefined)
  ) {
    const catalog = await prisma.gameCatalog.findUnique({
      where: { id: catalogId },
      select: { type: true, status: true, settings: true },
    });
    if (catalog?.type === "WHEEL_OF_FORTUNE") {
      const siblings = await prisma.gameGift.findMany({
        where: { gameCatalogId: catalogId },
        select: {
          id: true,
          name: true,
          isActive: true,
          probability: true,
          systemKey: true,
          sortOrder: true,
        },
      });
      const wheelSettings = resolveWheelSettingsFromCatalogSettings(
        catalog.settings,
      );
      const expected =
        wheelSettings.settings?.expectedSectorCount ?? WHEEL_DEFAULT_SECTOR_COUNT;
      const currentGifts = giftsToSectorGifts(siblings);
      const nextGifts = giftsToSectorGifts(
        siblings.map((gift) =>
          gift.id === id
            ? {
                ...gift,
                isActive: nextIsActive,
                probability: resolvedProbability,
              }
            : gift,
        ),
      );
      try {
        assertFutureWheelSectorConfig({
          catalogStatus: catalog.status,
          expectedSectorCount: expected,
          currentGifts,
          nextGifts,
        });
      } catch (error) {
        throw new GameAdminValidationError(
          error instanceof Error ? error.message : "Конфигурация колеса невалидна",
        );
      }
    }
  }

  const updated = await prisma.gameGift.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(shortDescription !== undefined ? { shortDescription } : {}),
      ...(!wheelLocked && input.image !== undefined
        ? { image: input.image || null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(nextProbability !== undefined ? { probability: nextProbability } : {}),
      ...(!wheelLocked && input.priority !== undefined
        ? { priority: input.priority }
        : {}),
      ...(!wheelLocked && input.cardStyle !== undefined
        ? { cardStyle: input.cardStyle }
        : {}),
      ...(!wheelLocked && input.allowedGameDirections !== undefined
        ? { allowedGameDirections: normalizeStrings(input.allowedGameDirections) }
        : {}),
      ...(!wheelLocked && input.allowedResultTypes !== undefined
        ? { allowedResultTypes: normalizeStrings(input.allowedResultTypes) }
        : {}),
      ...(!wheelLocked && input.requiredPremiumLevel !== undefined
        ? {
            requiredPremiumLevel: Math.max(
              0,
              toInt(input.requiredPremiumLevel, existing.requiredPremiumLevel),
            ),
          }
        : {}),
      ...(activationTouched || !existing.activationConditionText.trim()
        ? {
            activationMode,
            minCourseSessions,
            activationConditionText,
          }
        : {}),
      ...(nextSystemKey !== undefined ? { systemKey: nextSystemKey } : {}),
      ...(nextPrizeType !== undefined ? { prizeType: nextPrizeType } : {}),
      ...(nextPrizeRules !== undefined ? { prizeRules: nextPrizeRules } : {}),
      ...(nextSortOrder !== undefined ? { sortOrder: nextSortOrder } : {}),
      gameCatalogId: catalogId,
    },
  });

  return mapGift(updated);
}

export async function deleteGameGift(
  gameCatalogId: string,
  id: string,
): Promise<void> {
  const catalogId = await requireGameCatalogId(gameCatalogId);
  const existing = await prisma.gameGift.findUnique({
    where: { id },
    select: { id: true, gameCatalogId: true },
  });
  if (!existing) {
    throw new GameAdminNotFoundError("Подарок не найден");
  }

  try {
    assertGiftBelongsToCatalog({
      giftCatalogId: existing.gameCatalogId,
      expectedCatalogId: catalogId,
    });
  } catch (error) {
    wrapBindingError(error);
  }

  const historicalPlayCount = await prisma.gamePlay.count({
    where: {
      OR: [
        { selectedGiftId: id },
        { giftSnapshot: { path: ["giftId"], equals: id } },
        { giftSnapshot: { path: ["originalPrize", "giftId"], equals: id } },
        { giftSnapshot: { path: ["finalPrize", "giftId"], equals: id } },
      ],
    },
  });
  if (historicalPlayCount > 0) {
    throw new GameAdminValidationError(
      "Подарок уже использовался в играх. Отключите его вместо удаления.",
    );
  }

  const activeSessions = await prisma.gameSession.findMany({
    where: {
      gameCatalogId: catalogId,
      status: "ACTIVE",
    },
    select: { id: true, serverAssignment: true },
  });
  for (const session of activeSessions) {
    if (serverAssignmentReferencesGiftId(session.serverAssignment, id)) {
      throw new GameAdminValidationError(
        "Подарок назначен в активной игровой сессии. Отключите его вместо удаления.",
      );
    }
  }

  await prisma.gameGift.delete({ where: { id } });
}
