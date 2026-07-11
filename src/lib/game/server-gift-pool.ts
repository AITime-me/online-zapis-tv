export type ServerGiftPoolItem = {
  isActive: boolean;
  requiredPremiumLevel: number;
};

/**
 * C0 server policy: client score/direction/premium never expand gift eligibility.
 * Only active gifts with requiredPremiumLevel === 0 enter the server pool.
 */
export function buildServerEligibleGiftPool<T extends ServerGiftPoolItem>(
  gifts: T[],
): T[] {
  return gifts.filter(
    (gift) => gift.isActive && gift.requiredPremiumLevel === 0,
  );
}
