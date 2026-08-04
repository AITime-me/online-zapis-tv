import { prisma } from "@/lib/db";
import { HOME_PROMO_ROUTES, type HomePromotion } from "@/components/home/home-data";
import {
  dedupeHomePromotionCards,
  isGameCatalogEligibleForHomepage,
  LEGACY_CATCH_TIME_HOME_PROMOTION_ID,
  mapGameCatalogToHomePromotion,
} from "@/lib/promotions/home-game-catalog";
import { isPromotionEligibleForHomepageCarousel } from "@/lib/promotions/homepage-eligibility";
import { getStudioNow } from "@/lib/datetime/date-layer";
import { listHomepagePromotions } from "@/services/PromotionCrudService";
import {
  ensureLegacyCatchTimeGameCatalog,
  isGameCatalogPubliclyAvailable,
  listHomepageGameCatalogs,
} from "@/services/GameCatalogService";

const DEFAULT_CONFIG_ID = "default";

function mapPromotionToHomeCard(promotion: Awaited<
  ReturnType<typeof listHomepagePromotions>
>[number]): HomePromotion | null {
  if (!isPromotionEligibleForHomepageCarousel(promotion, getStudioNow())) {
    return null;
  }

  const description =
    promotion.shortDescription?.trim() ||
    promotion.description?.trim() ||
    "";

  return {
    id: promotion.id,
    kind: promotion.type === "gift" || promotion.type === "game" ? "gift" : "standard",
    title: promotion.title,
    description,
    ctaLabel: promotion.ctaText?.trim() || "Подробнее",
    ctaHref: promotion.ctaLink?.trim() || "/booking",
    badgeLabel: promotion.type === "gift" ? "Подарок" : "Акция",
    sortOrder: promotion.priority,
    isActive: true,
    imageUrl: promotion.imageUrl ?? undefined,
  };
}

function mapHomepageGameCatalogCards(
  games: Awaited<ReturnType<typeof listHomepageGameCatalogs>>,
): HomePromotion[] {
  return games
    .filter((game) => isGameCatalogEligibleForHomepage(game))
    .map((game) => mapGameCatalogToHomePromotion(game));
}

export async function getHomePromotions(): Promise<HomePromotion[]> {
  const [dbPromotions, config, catchTimeGame, homepageGames] = await Promise.all([
    listHomepagePromotions(),
    prisma.gameConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } }),
    ensureLegacyCatchTimeGameCatalog(),
    listHomepageGameCatalogs(),
  ]);

  const promotionCards = dbPromotions
    .map(mapPromotionToHomeCard)
    .filter((card): card is HomePromotion => card !== null);

  const dynamicPromotions: HomePromotion[] = [
    ...promotionCards,
    ...mapHomepageGameCatalogCards(homepageGames),
  ];

  if (
    config?.isActive &&
    isGameCatalogPubliclyAvailable({
      ...catchTimeGame,
      status: catchTimeGame.status,
      type: catchTimeGame.type,
    })
  ) {
    dynamicPromotions.push({
      id: LEGACY_CATCH_TIME_HOME_PROMOTION_ID,
      kind: "game",
      title: config.title,
      description: config.description,
      ctaLabel: config.ctaButtonText,
      ctaHref: catchTimeGame.publicPath || HOME_PROMO_ROUTES.procedureGiftGame,
      badgeLabel: "Подарок",
      sortOrder: 2,
      isActive: true,
      imageUrl: config.image ?? undefined,
    });
  }

  return dedupeHomePromotionCards(dynamicPromotions).sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
}
