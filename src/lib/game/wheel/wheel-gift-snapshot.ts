import type { GiftSnapshot } from "@/lib/game/session/game-session-snapshot";
import type { PrizeRulesV1 } from "@/lib/game/wheel/prize-rules-contract";
import { prizeRulesToJson } from "@/lib/game/wheel/prize-rules-contract";
import type { GamePrizeType } from "@/lib/game/wheel/prize-types";
import type { WheelInterestKey } from "@/lib/game/wheel/procedure-types";
import type { PrizeReplacementReason } from "@/lib/game/wheel/prize-replacement";
import type { WheelZone } from "@/lib/game/wheel/zone-types";

export type WheelGiftSnapshotExtension = {
  ruleType: "wheel_sector";
  prizeType: GamePrizeType;
  systemKey: string;
  sectorIndex: number;
  totalSectors: number;
  prizeRules: PrizeRulesV1;
  originalPrize: {
    systemKey: string;
    giftId: string;
    name: string;
  };
  finalPrize: {
    systemKey: string;
    giftId: string;
    name: string;
  };
  replacementApplied: boolean;
  replacementReason: PrizeReplacementReason | null;
  confirmedInterest: WheelInterestKey | null;
  confirmedZone: WheelZone | null;
  replacedAt: string | null;
};

export type WheelAwareGiftSnapshot = GiftSnapshot &
  Partial<WheelGiftSnapshotExtension>;

export function buildWheelGiftSnapshotFields(input: {
  prizeType: GamePrizeType;
  systemKey: string;
  sectorIndex: number;
  totalSectors: number;
  prizeRules: PrizeRulesV1;
  giftId: string;
  name: string;
}): Pick<
  WheelGiftSnapshotExtension,
  | "ruleType"
  | "prizeType"
  | "systemKey"
  | "sectorIndex"
  | "totalSectors"
  | "prizeRules"
  | "originalPrize"
  | "finalPrize"
  | "replacementApplied"
  | "replacementReason"
  | "confirmedInterest"
  | "confirmedZone"
  | "replacedAt"
> {
  const identity = {
    systemKey: input.systemKey,
    giftId: input.giftId,
    name: input.name,
  };
  return {
    ruleType: "wheel_sector",
    prizeType: input.prizeType,
    systemKey: input.systemKey,
    sectorIndex: input.sectorIndex,
    totalSectors: input.totalSectors,
    prizeRules: prizeRulesToJson(input.prizeRules),
    originalPrize: identity,
    finalPrize: identity,
    replacementApplied: false,
    replacementReason: null,
    confirmedInterest: null,
    confirmedZone: null,
    replacedAt: null,
  };
}

export function applyReplacementToWheelGiftSnapshot(
  snapshot: WheelAwareGiftSnapshot,
  input: {
    finalPrize: { systemKey: string; giftId: string; name: string };
    finalPrizeType: GamePrizeType;
    finalPrizeRules: PrizeRulesV1;
    confirmedInterest: WheelInterestKey;
    confirmedZone: WheelZone;
    replacementReason: PrizeReplacementReason;
    replacedAt: string;
  },
): WheelAwareGiftSnapshot {
  const original = snapshot.originalPrize ?? {
    systemKey: snapshot.systemKey ?? snapshot.giftId,
    giftId: snapshot.giftId,
    name: snapshot.name,
  };

  return {
    ...snapshot,
    giftId: input.finalPrize.giftId,
    name: input.finalPrize.name,
    prizeType: input.finalPrizeType,
    systemKey: input.finalPrize.systemKey,
    prizeRules: prizeRulesToJson(input.finalPrizeRules),
    originalPrize: original,
    finalPrize: input.finalPrize,
    replacementApplied: true,
    replacementReason: input.replacementReason,
    confirmedInterest: input.confirmedInterest,
    confirmedZone: input.confirmedZone,
    replacedAt: input.replacedAt,
    shortDescription: snapshot.shortDescription,
  };
}
