import { prisma } from "@/lib/db";
import {
  HOME_PROMOTIONS,
  HOME_PROMO_ROUTES,
  type HomePromotion,
} from "@/components/home/home-data";

const GAME_PROMOTION_ID = "procedure-gift-game";
const DEFAULT_CONFIG_ID = "default";

export async function getHomePromotions(): Promise<HomePromotion[]> {
  const staticPromotions = HOME_PROMOTIONS.filter(
    (promotion) => promotion.isActive !== false,
  );

  const config = await prisma.gameConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
  });

  if (!config?.isActive) {
    return [...staticPromotions].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }

  const gamePromotion: HomePromotion = {
    id: GAME_PROMOTION_ID,
    kind: "game",
    title: config.title,
    description: config.description,
    ctaLabel: config.ctaButtonText,
    ctaHref: config.ctaButtonLink || HOME_PROMO_ROUTES.procedureGiftGame,
    badgeLabel: "Подарок",
    sortOrder: 2,
    isActive: true,
    imageUrl: config.image ?? undefined,
  };

  return [...staticPromotions, gamePromotion].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
}
