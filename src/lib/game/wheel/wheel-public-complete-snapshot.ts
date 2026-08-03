import "server-only";

import { buildGiftSnapshot } from "@/lib/game/session/game-session-snapshot";
import { resolvePrizeReplacement } from "@/lib/game/wheel/prize-replacement";
import { prizeRulesToJson } from "@/lib/game/wheel/prize-rules-contract";
import type { WheelInterestKey } from "@/lib/game/wheel/procedure-types";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import type { WheelFrozenPrizeGiftV1 } from "@/lib/game/wheel/wheel-assignment-prize-snapshot";
import {
  applyReplacementToWheelGiftSnapshot,
  buildWheelGiftSnapshotFields,
  type WheelAwareGiftSnapshot,
} from "@/lib/game/wheel/wheel-gift-snapshot";
import type { WheelZone } from "@/lib/game/wheel/zone-types";

function frozenToGiftSource(frozen: WheelFrozenPrizeGiftV1) {
  return {
    id: frozen.giftId,
    name: frozen.displayName,
    shortDescription: frozen.shortDescription,
    image: frozen.image,
    priority: frozen.priority,
    cardStyle: frozen.cardStyle,
    activationMode: frozen.activationMode,
    minCourseSessions: frozen.minCourseSessions,
    activationConditionText: frozen.activationConditionText,
    systemKey: frozen.prizeSystemKey,
    prizeType: frozen.prizeType,
    prizeRules: prizeRulesToJson(frozen.prizeRules),
  };
}

export function buildWheelCompleteGiftSnapshot(input: {
  assignment: WheelServerAssignmentV1;
  confirmedInterest: WheelInterestKey;
  confirmedZone: WheelZone;
  now: Date;
}): { ok: true; giftSnapshot: WheelAwareGiftSnapshot; selectedGiftId: string } | { ok: false; error: string } {
  const frozen = input.assignment.prizeSnapshot;
  const original = frozen.original;

  const base = buildGiftSnapshot(frozenToGiftSource(original), input.now);
  const wheelFields = buildWheelGiftSnapshotFields({
    prizeType: original.prizeType,
    systemKey: original.prizeSystemKey,
    sectorIndex: input.assignment.sectorIndex,
    totalSectors: input.assignment.totalSectors,
    prizeRules: original.prizeRules,
    giftId: original.giftId,
    name: original.displayName,
  });

  let giftSnapshot: WheelAwareGiftSnapshot = {
    ...base,
    ...wheelFields,
    ruleType: "wheel_sector",
    confirmedInterest: input.confirmedInterest,
    confirmedZone: input.confirmedZone,
    originalPrize: {
      systemKey: original.prizeSystemKey,
      giftId: original.giftId,
      name: original.displayName,
    },
    finalPrize: {
      systemKey: original.prizeSystemKey,
      giftId: original.giftId,
      name: original.displayName,
    },
  };

  let selectedGiftId = original.giftId;

  const replacement = resolvePrizeReplacement({
    original: {
      systemKey: original.prizeSystemKey,
      giftId: original.giftId,
      name: original.displayName,
    },
    originalRules: original.prizeRules,
    confirmedInterest: input.confirmedInterest,
    confirmedZone: input.confirmedZone,
    fallbackPrize: frozen.replacementFallback
      ? {
          systemKey: frozen.replacementFallback.prizeSystemKey,
          giftId: frozen.replacementFallback.giftId,
          name: frozen.replacementFallback.displayName,
        }
      : null,
    now: input.now,
  });

  if (replacement.replaced) {
    const finalFrozen = frozen.replacementFallback;
    if (
      !finalFrozen ||
      finalFrozen.giftId !== replacement.final.giftId ||
      finalFrozen.prizeSystemKey !== replacement.final.systemKey
    ) {
      return { ok: false, error: "Приз замены недоступен" };
    }
    giftSnapshot = applyReplacementToWheelGiftSnapshot(giftSnapshot, {
      finalPrize: replacement.final,
      finalPrizeType: finalFrozen.prizeType,
      finalPrizeRules: finalFrozen.prizeRules,
      confirmedInterest: replacement.confirmedInterest,
      confirmedZone: replacement.confirmedZone,
      replacementReason: replacement.replacementReason,
      replacedAt: replacement.replacedAt,
    });
    selectedGiftId = finalFrozen.giftId;
  }

  return { ok: true, giftSnapshot, selectedGiftId };
}

export function prizeDisplayNameFromAssignment(
  assignment: WheelServerAssignmentV1,
): string {
  return assignment.prizeSnapshot.original.displayName;
}
