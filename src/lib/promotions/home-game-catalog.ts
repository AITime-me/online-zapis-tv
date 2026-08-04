import type { HomePromotion } from "@/components/home/home-data";
import { buildGamePublicPath } from "@/lib/games/catalog-contract";
import {
  canActivateGameCatalog,
  GAME_CATALOG_TYPE_LABELS,
  type GameCatalogDto,
  type GameCatalogTypeDto,
} from "@/types/game-catalog";

export const LEGACY_CATCH_TIME_HOME_PROMOTION_ID = "procedure-gift-game";

type GameCatalogHomepageInput = Pick<
  GameCatalogDto,
  "id" | "slug" | "title" | "description" | "type" | "status" | "showOnHomepage" | "publicPriority"
>;

export function isGameCatalogEligibleForHomepage(
  game: GameCatalogHomepageInput,
): boolean {
  if (!game.showOnHomepage) {
    return false;
  }

  const slug = game.slug.trim();
  if (!slug) {
    return false;
  }

  if (game.status !== "active") {
    return false;
  }

  return canActivateGameCatalog(game.type, game.status);
}

function resolveGameCatalogBadgeLabel(type: GameCatalogTypeDto): string {
  if (type === "wheel_of_fortune") {
    return "Игра";
  }
  return GAME_CATALOG_TYPE_LABELS[type];
}

export function mapGameCatalogToHomePromotion(
  game: GameCatalogHomepageInput,
): HomePromotion {
  const description = game.description?.trim() || "";

  return {
    id: `game-catalog-${game.id}`,
    kind: "game",
    title: game.title,
    description,
    ctaLabel: "Подробнее",
    ctaHref: buildGamePublicPath(game.slug),
    badgeLabel: resolveGameCatalogBadgeLabel(game.type),
    sortOrder: game.publicPriority,
    isActive: true,
  };
}

export function dedupeHomePromotionCards(cards: HomePromotion[]): HomePromotion[] {
  const seenHrefs = new Set<string>();
  const result: HomePromotion[] = [];

  for (const card of cards) {
    const href = card.ctaHref.trim();
    if (!href || seenHrefs.has(href)) {
      continue;
    }
    seenHrefs.add(href);
    result.push(card);
  }

  return result;
}
