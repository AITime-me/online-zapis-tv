import type { CatchTimeServerAssignmentV1 } from "@/lib/game/tier/server-assignment-contract";
import type { WheelClaimLockV1 } from "@/lib/game/wheel/wheel-claim-lock";
import type { WheelAssignmentPrizeSnapshotV1 } from "@/lib/game/wheel/wheel-assignment-prize-snapshot";

/**
 * Wheel assignment is written at session start — before any client animation.
 * Client must animate the persisted sectorIndex; never trust client sector/prize ids.
 * prizeSnapshot freezes prize metadata at start; complete must not read live GameGift.
 * Optional claimLock freezes confirmed interest/zone and the compatible final prize
 * at spin time without changing the original sector roll.
 */
export type WheelServerAssignmentV1 = {
  version: 1;
  mechanicType: "WHEEL_OF_FORTUNE";
  serverResultTier: 0;
  campaignKey: string | null;
  rulesVersion: string;
  assignedAt: string;
  tierBucket: "tier-0";
  sectorIndex: number;
  totalSectors: number;
  prizeSystemKey: string;
  giftId: string;
  prizeSnapshot: WheelAssignmentPrizeSnapshotV1;
  claimLock?: WheelClaimLockV1;
};

export type GameServerAssignmentV1 =
  | CatchTimeServerAssignmentV1
  | WheelServerAssignmentV1;

export const WHEEL_SERVER_ASSIGNMENT_VERSION = 1 as const;
