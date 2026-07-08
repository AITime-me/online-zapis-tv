import { prisma } from "@/lib/db";
import type {
  GameConfigDto,
  GameConfigWriteInput,
  GameGiftDto,
  GameGiftWriteInput,
} from "@/types/game-admin";

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

function mapGift(row: Awaited<ReturnType<typeof prisma.gameGift.findMany>>[number]): GameGiftDto {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGameAdminPageData(): Promise<{
  config: GameConfigDto;
  gifts: GameGiftDto[];
}> {
  const [configRow, gifts] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } }),
    prisma.gameGift.findMany({ orderBy: [{ isActive: "desc" }, { probability: "desc" }, { createdAt: "asc" }] }),
  ]);

  return { config: mapConfig(configRow), gifts: gifts.map(mapGift) };
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

export async function createGameGift(input: GameGiftWriteInput): Promise<GameGiftDto> {
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
    },
  });

  return mapGift(created);
}

export async function updateGameGift(id: string, input: Partial<GameGiftWriteInput>): Promise<GameGiftDto> {
  const existing = await prisma.gameGift.findUnique({ where: { id } });
  if (!existing) {
    throw new GameAdminNotFoundError("Подарок не найден");
  }

  const name = input.name?.trim();
  const shortDescription = input.shortDescription?.trim();
  if (name !== undefined && !name) {
    throw new GameAdminValidationError("Название подарка не может быть пустым");
  }
  if (shortDescription !== undefined && !shortDescription) {
    throw new GameAdminValidationError("Описание подарка не может быть пустым");
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
        ? { requiredPremiumLevel: Math.max(0, toInt(input.requiredPremiumLevel, existing.requiredPremiumLevel)) }
        : {}),
    },
  });

  return mapGift(updated);
}

export async function deleteGameGift(id: string): Promise<void> {
  const existing = await prisma.gameGift.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new GameAdminNotFoundError("Подарок не найден");
  }
  await prisma.gameGift.delete({ where: { id } });
}

