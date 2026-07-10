import { prisma } from "@/lib/db";
import {
  HOME_PROMOTIONS,
  HOME_PROMO_ROUTES,
  type HomePromotion,
} from "@/components/home/home-data";
import { isPromotionEligibleForHomepageCarousel } from "@/lib/promotions/homepage-eligibility";
import { getStudioNow } from "@/lib/datetime/date-layer";
import { listHomepagePromotions } from "@/services/PromotionCrudService";
import {
  ensureLegacyCatchTimeGameCatalog,
  isGameCatalogPubliclyAvailable,
} from "@/services/GameCatalogService";

const GAME_PROMOTION_ID = "procedure-gift-game";
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

export async function getHomePromotions(): Promise<HomePromotion[]> {
  const staticPromotions = HOME_PROMOTIONS.filter(
    (promotion) => promotion.isActive !== false,
  );

  const [dbPromotions, config, catchTimeGame] = await Promise.all([
    listHomepagePromotions(),
    prisma.gameConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } }),
    ensureLegacyCatchTimeGameCatalog(),
  ]);

  const promotionCards = dbPromotions
    .map(mapPromotionToHomeCard)
    .filter((card): card is HomePromotion => card !== null);

  const dynamicPromotions: HomePromotion[] = [...staticPromotions, ...promotionCards];

  if (
    config?.isActive &&
    isGameCatalogPubliclyAvailable({
      ...catchTimeGame,
      status: catchTimeGame.status,
      type: catchTimeGame.type,
    })
  ) {
    dynamicPromotions.push({
      id: GAME_PROMOTION_ID,
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

  return dynamicPromotions.sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
}
