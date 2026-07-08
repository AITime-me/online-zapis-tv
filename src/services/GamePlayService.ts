import { prisma } from "@/lib/db";

export type GameResultInput = {
  gameDirection: string;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
};

export type SelectedGameGift = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowed(list: string[], value: string): boolean {
  if (list.length === 0) {
    return true;
  }
  const token = normalizeToken(value);
  return list.some((entry) => normalizeToken(entry) === token);
}

function weightedPick<T extends { probability: number }>(items: T[]): T | null {
  const weights = items.map((item) => Math.max(0, Math.trunc(item.probability ?? 0)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return null;
  }
  const roll = Math.random() * total;
  let cursor = 0;
  for (let i = 0; i < items.length; i += 1) {
    cursor += weights[i]!;
    if (roll < cursor) {
      return items[i]!;
    }
  }
  return items[items.length - 1] ?? null;
}

function mapGift(row: Awaited<ReturnType<typeof prisma.gameGift.findMany>>[number]): SelectedGameGift {
  return {
    id: row.id,
    name: row.name,
    shortDescription: row.shortDescription,
    image: row.image ?? null,
    priority: row.priority,
    cardStyle: row.cardStyle,
  };
}

export async function createGamePlayAndSelectGift(input: GameResultInput): Promise<{
  playId: string;
  gift: SelectedGameGift | null;
}> {
  const gameDirection = input.gameDirection.trim();
  const skinNeed = input.skinNeed.trim();
  const resultType = input.resultType.trim();
  const premiumLevel = Number.isFinite(input.premiumLevel)
    ? Math.max(0, Math.trunc(input.premiumLevel))
    : 0;

  const config = await prisma.gameConfig.findUnique({ where: { id: "default" } });
  if (!config?.isActive) {
    const play = await prisma.gamePlay.create({
      data: {
        gameDirection,
        skinNeed,
        resultType,
        premiumLevel,
        selectedGiftId: null,
      },
      select: { id: true },
    });
    return { playId: play.id, gift: null };
  }

  const gifts = await prisma.gameGift.findMany({
    where: { isActive: true },
    orderBy: [{ probability: "desc" }, { createdAt: "asc" }],
  });

  const eligible = gifts.filter((gift) => {
    if (premiumLevel < gift.requiredPremiumLevel) {
      return false;
    }
    if (!isAllowed(gift.allowedGameDirections, gameDirection)) {
      return false;
    }
    if (!isAllowed(gift.allowedResultTypes, resultType)) {
      return false;
    }
    return true;
  });

  const picked = weightedPick(eligible) ?? null;

  const play = await prisma.gamePlay.create({
    data: {
      gameDirection,
      skinNeed,
      resultType,
      premiumLevel,
      selectedGiftId: picked?.id ?? null,
    },
    select: { id: true },
  });

  return { playId: play.id, gift: picked ? mapGift(picked) : null };
}

