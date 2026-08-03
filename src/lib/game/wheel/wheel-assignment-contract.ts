import type { CatchTimeServerAssignmentV1 } from "@/lib/game/tier/server-assignment-contract";

/**
 * Wheel assignment is written at session start — before any client animation.
 * Client must animate the persisted sectorIndex; never trust client sector/prize ids.
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
};

export type GameServerAssignmentV1 =
  | CatchTimeServerAssignmentV1
  | WheelServerAssignmentV1;

export const WHEEL_SERVER_ASSIGNMENT_VERSION = 1 as const;
