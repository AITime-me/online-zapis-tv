import { randomInt as cryptoRandomInt } from "node:crypto";
import { normalizeGiftWeight } from "@/lib/game/weighted-gift-pick";
import { WHEEL_DEFAULT_SECTOR_COUNT } from "@/lib/game/wheel/default-prizes";

export type WheelSectorGift = {
  id: string;
  systemKey: string;
  name: string;
  isActive: boolean;
  /** Sector count / weight (maps from GameGift.probability). */
  probability: number;
  sortOrder: number;
};

export type WheelSectorSlot = {
  sectorIndex: number;
  giftId: string;
  systemKey: string;
  name: string;
};

export type WheelSectorAssignment = {
  sectorIndex: number;
  giftId: string;
  systemKey: string;
  name: string;
  totalSectors: number;
};

export type BuildWheelSectorsResult =
  | { ok: true; slots: WheelSectorSlot[]; totalSectors: number }
  | { ok: false; error: string; totalSectors: number };

/**
 * Expand active gifts into ordered visual sectors.
 * Inactive gifts never appear. Sector count must equal expectedSectorCount.
 */
export function buildWheelSectorSlots(
  gifts: WheelSectorGift[],
  expectedSectorCount: number = WHEEL_DEFAULT_SECTOR_COUNT,
): BuildWheelSectorsResult {
  const active = gifts
    .filter((gift) => gift.isActive && normalizeGiftWeight(gift.probability) > 0)
    .slice()
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.systemKey.localeCompare(b.systemKey);
    });

  const slots: WheelSectorSlot[] = [];
  for (const gift of active) {
    const count = normalizeGiftWeight(gift.probability);
    for (let i = 0; i < count; i += 1) {
      slots.push({
        sectorIndex: slots.length,
        giftId: gift.id,
        systemKey: gift.systemKey,
        name: gift.name,
      });
    }
  }

  if (slots.length !== expectedSectorCount) {
    return {
      ok: false,
      error: `Сумма визуальных секторов должна быть ${expectedSectorCount}, сейчас ${slots.length}`,
      totalSectors: slots.length,
    };
  }

  return { ok: true, slots, totalSectors: slots.length };
}

export function assignWheelSector(
  gifts: WheelSectorGift[],
  options?: {
    expectedSectorCount?: number;
    randomInt?: (maxExclusive: number) => number;
  },
): WheelSectorAssignment | null {
  const expected =
    options?.expectedSectorCount ?? WHEEL_DEFAULT_SECTOR_COUNT;
  const built = buildWheelSectorSlots(gifts, expected);
  if (!built.ok) {
    return null;
  }

  const randomIntFn = options?.randomInt ?? ((max) => cryptoRandomInt(max));
  const sectorIndex = randomIntFn(built.slots.length);
  const slot = built.slots[sectorIndex];
  if (!slot) {
    return null;
  }

  return {
    sectorIndex: slot.sectorIndex,
    giftId: slot.giftId,
    systemKey: slot.systemKey,
    name: slot.name,
    totalSectors: built.totalSectors,
  };
}

export function sumActiveWheelSectors(gifts: WheelSectorGift[]): number {
  return gifts.reduce((sum, gift) => {
    if (!gift.isActive) {
      return sum;
    }
    return sum + normalizeGiftWeight(gift.probability);
  }, 0);
}

export function validateWheelSectorConfiguration(
  gifts: WheelSectorGift[],
  expectedSectorCount: number = WHEEL_DEFAULT_SECTOR_COUNT,
): { ok: true; totalSectors: number } | { ok: false; error: string; totalSectors: number } {
  const built = buildWheelSectorSlots(gifts, expectedSectorCount);
  if (!built.ok) {
    return built;
  }
  return { ok: true, totalSectors: built.totalSectors };
}
