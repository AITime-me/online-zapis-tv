import { prisma } from "@/lib/db";
import {
  assertCreateGiftCatalogId,
  assertGiftBelongsToCatalog,
  GAME_GIFT_CATALOG_NOT_FOUND_ERROR,
  rejectClientCatalogRebind,
} from "@/lib/game/admin-gift-catalog-binding";
import {
  generateActivationConditionText,
  validateGiftActivationInput,
  type GameGiftActivationMode,
} from "@/lib/game/gift-activation";
import type {
  GameConfigDto,
  GameConfigWriteInput,
  GameGiftDto,
  GameGiftWriteInput,
} from "@/types/game-admin";
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

  const name = input.name?.trim();
  const shortDescription = input.shortDescription?.trim();
  if (name !== undefined && !name) {
    throw new GameAdminValidationError("Название подарка не может быть пустым");
  }
  if (shortDescription !== undefined && !shortDescription) {
    throw new GameAdminValidationError("Описание подарка не может быть пустым");
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

  const updated = await prisma.gameGift.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(shortDescription !== undefined ? { shortDescription } : {}),
      ...(input.image !== undefined ? { image: input.image || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.probability !== undefined
        ? { probability: Math.max(0, toInt(input.probability, existing.probability)) }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.cardStyle !== undefined ? { cardStyle: input.cardStyle } : {}),
      ...(input.allowedGameDirections !== undefined
        ? { allowedGameDirections: normalizeStrings(input.allowedGameDirections) }
        : {}),
      ...(input.allowedResultTypes !== undefined
        ? { allowedResultTypes: normalizeStrings(input.allowedResultTypes) }
        : {}),
      ...(input.requiredPremiumLevel !== undefined
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

  await prisma.gameGift.delete({ where: { id } });
}
