import type { ServerGiftPoolItem } from "@/lib/game/server-gift-pool";
import { normalizeGiftWeight } from "@/lib/game/weighted-gift-pick";

export type CatalogGiftPoolItem = ServerGiftPoolItem & {
  gameCatalogId: string | null;
  probability: number;
};

export function buildCatalogScopedGiftPool<T extends CatalogGiftPoolItem>(
  gifts: T[],
  gameCatalogId: string,
  serverResultTier: number,
): T[] {
  return gifts.filter((gift) => {
    if (!gift.isActive) {
      return false;
    }
    if (gift.gameCatalogId !== gameCatalogId) {
      return false;
    }
    if (gift.requiredPremiumLevel > serverResultTier) {
      return false;
    }
    if (normalizeGiftWeight(gift.probability) <= 0) {
      return false;
    }
    return true;
  });
}
