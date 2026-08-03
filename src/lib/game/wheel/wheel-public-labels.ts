import { WHEEL_DEFAULT_SECTOR_COUNT } from "@/lib/game/wheel/default-prizes";
import { buildWheelSectorSlots } from "@/lib/game/wheel/sector-assignment";
import { giftsToSectorGifts } from "@/lib/game/wheel/wheel-admin";
import type { WheelPublicSectorLabel } from "@/lib/game/wheel/wheel-public-dto";

export function buildPublicSectorLabels(
  gifts: Array<{
    id: string;
    name: string;
    isActive: boolean;
    probability: number;
    systemKey: string | null;
    sortOrder: number;
  }>,
  expectedSectorCount = WHEEL_DEFAULT_SECTOR_COUNT,
): WheelPublicSectorLabel[] {
  const built = buildWheelSectorSlots(
    giftsToSectorGifts(gifts),
    expectedSectorCount,
  );
  if (!built.ok) {
    return [];
  }
  return built.slots.map((slot) => ({
    sectorIndex: slot.sectorIndex,
    prizeDisplayName: slot.name,
  }));
}
