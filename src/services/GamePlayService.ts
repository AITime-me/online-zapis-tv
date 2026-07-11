import "server-only";

import { prisma } from "@/lib/db";
import {
  GamePlayGiftPoolEmptyError,
  GamePlayUnavailableError,
} from "@/lib/game/game-play-errors";
import { buildServerEligibleGiftPool } from "@/lib/game/server-gift-pool";
import { weightedGiftPick } from "@/lib/game/weighted-gift-pick";
import { normalizeGameSlug } from "@/lib/games/catalog-contract";
import { canActivateGameCatalog } from "@/types/game-catalog";

export type GameResultInput = {
  gameDirection: string;
  skinNeed: string;
  resultType: string;
  premiumLevel: number;
  catalogSlug?: string | null;
};

export type SelectedGameGift = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
};

function mapGift(
  row: Awaited<ReturnType<typeof prisma.gameGift.findMany>>[number],
): SelectedGameGift {
  return {
    id: row.id,
    name: row.name,
    shortDescription: row.shortDescription,
    image: row.image ?? null,
    priority: row.priority,
    cardStyle: row.cardStyle,
  };
}

async function resolveActiveGameConfigId(
  catalogSlug: string | null | undefined,
): Promise<string> {
  let configId = "default";

  if (catalogSlug?.trim()) {
    const catalog = await prisma.gameCatalog.findUnique({
      where: { slug: normalizeGameSlug(catalogSlug) },
      select: {
        status: true,
        type: true,
        legacyConfigId: true,
      },
    });

    if (!catalog || catalog.status !== "ACTIVE") {
      throw new GamePlayUnavailableError();
    }

    const type =
      catalog.type === "WHEEL_OF_FORTUNE" ? "wheel_of_fortune" : "catch_time";
    if (!canActivateGameCatalog(type, "active")) {
      throw new GamePlayUnavailableError();
    }

    configId = catalog.legacyConfigId ?? "default";
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: configId },
    select: { id: true, isActive: true },
  });

  if (!config?.isActive) {
    throw new GamePlayUnavailableError();
  }

  return config.id;
}

export async function createGamePlayAndSelectGift(input: GameResultInput): Promise<{
  playId: string;
  gift: SelectedGameGift;
}> {
  await resolveActiveGameConfigId(input.catalogSlug);

  const gameDirection = input.gameDirection.trim();
  const skinNeed = input.skinNeed.trim();
  const resultType = input.resultType.trim();
  const premiumLevel = Number.isFinite(input.premiumLevel)
    ? Math.max(0, Math.trunc(input.premiumLevel))
    : 0;

  const gifts = await prisma.gameGift.findMany({
    where: { isActive: true },
    orderBy: [{ probability: "desc" }, { createdAt: "asc" }],
  });

  const eligible = buildServerEligibleGiftPool(gifts);
  if (eligible.length === 0) {
    throw new GamePlayGiftPoolEmptyError();
  }

  const picked = weightedGiftPick(eligible);
  if (!picked) {
    throw new GamePlayGiftPoolEmptyError();
  }

  const play = await prisma.gamePlay.create({
    data: {
      gameDirection,
      skinNeed,
      resultType,
      premiumLevel,
      selectedGiftId: picked.id,
    },
    select: { id: true },
  });

  return { playId: play.id, gift: mapGift(picked) };
}
