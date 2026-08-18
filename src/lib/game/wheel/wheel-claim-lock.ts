import {
  isPrizeReplacementReason,
  resolvePrizeReplacement,
  type PrizeReplacementReason,
} from "@/lib/game/wheel/prize-replacement";
import {
  isWheelInterestKey,
  type WheelInterestKey,
} from "@/lib/game/wheel/procedure-types";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";
import { isWheelZone, type WheelZone } from "@/lib/game/wheel/zone-types";

export type WheelClaimPrizeIdentity = {
  systemKey: string;
  giftId: string;
  name: string;
};

export type WheelClaimLockV1 = {
  version: 1;
  interest: WheelInterestKey;
  confirmedZone: WheelZone;
  originalPrize: WheelClaimPrizeIdentity;
  finalPrize: WheelClaimPrizeIdentity;
  replacementApplied: boolean;
  replacementReason: PrizeReplacementReason | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePrizeIdentity(value: unknown): WheelClaimPrizeIdentity | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (
    typeof value.systemKey !== "string" ||
    !value.systemKey.trim() ||
    typeof value.giftId !== "string" ||
    !value.giftId.trim() ||
    typeof value.name !== "string" ||
    !value.name.trim()
  ) {
    return null;
  }
  return {
    systemKey: value.systemKey.trim(),
    giftId: value.giftId.trim(),
    name: value.name.trim(),
  };
}

export function parseWheelClaimLock(raw: unknown): WheelClaimLockV1 | null {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return null;
  }
  if (!isWheelInterestKey(raw.interest) || !isWheelZone(raw.confirmedZone)) {
    return null;
  }
  const originalPrize = parsePrizeIdentity(raw.originalPrize);
  const finalPrize = parsePrizeIdentity(raw.finalPrize);
  if (!originalPrize || !finalPrize) {
    return null;
  }
  if (typeof raw.replacementApplied !== "boolean") {
    return null;
  }
  const reason = raw.replacementReason;
  if (reason !== null && !isPrizeReplacementReason(reason)) {
    return null;
  }
  if (raw.replacementApplied && reason === null) {
    return null;
  }
  if (!raw.replacementApplied && reason !== null) {
    return null;
  }

  return {
    version: 1,
    interest: raw.interest,
    confirmedZone: raw.confirmedZone,
    originalPrize,
    finalPrize,
    replacementApplied: raw.replacementApplied,
    replacementReason: reason,
  };
}

/**
 * Freeze interest/zone and the compatible final prize at spin time.
 * Does not change sectorIndex or the original assigned gift identity.
 */
export function buildWheelClaimLock(input: {
  assignment: WheelServerAssignmentV1;
  confirmedInterest: WheelInterestKey;
  confirmedZone: WheelZone;
  now: Date;
}): WheelClaimLockV1 {
  const originalFrozen = input.assignment.prizeSnapshot.original;
  const originalPrize: WheelClaimPrizeIdentity = {
    systemKey: originalFrozen.prizeSystemKey,
    giftId: originalFrozen.giftId,
    name: originalFrozen.displayName,
  };
  const fallbackFrozen = input.assignment.prizeSnapshot.replacementFallback;
  const decision = resolvePrizeReplacement({
    original: originalPrize,
    originalRules: originalFrozen.prizeRules,
    confirmedInterest: input.confirmedInterest,
    confirmedZone: input.confirmedZone,
    fallbackPrize: fallbackFrozen
      ? {
          systemKey: fallbackFrozen.prizeSystemKey,
          giftId: fallbackFrozen.giftId,
          name: fallbackFrozen.displayName,
        }
      : null,
    now: input.now,
  });

  return {
    version: 1,
    interest: input.confirmedInterest,
    confirmedZone: input.confirmedZone,
    originalPrize,
    finalPrize: decision.final,
    replacementApplied: decision.replaced,
    replacementReason: decision.replacementReason,
  };
}

export function withWheelClaimLock(
  assignment: WheelServerAssignmentV1,
  claimLock: WheelClaimLockV1,
): WheelServerAssignmentV1 {
  return {
    ...assignment,
    claimLock,
  };
}

export function resolveWheelPublicPrizeDisplayName(
  assignment: WheelServerAssignmentV1,
): string {
  const lockedFinal = assignment.claimLock?.finalPrize?.name?.trim();
  if (lockedFinal) {
    return lockedFinal;
  }
  return assignment.prizeSnapshot.original.displayName;
}

export function overlayWinningSectorLabels<
  T extends { sectorIndex: number; prizeDisplayName: string },
>(labels: T[], sectorIndex: number, prizeDisplayName: string): T[] {
  const finalName = prizeDisplayName.trim();
  if (!finalName) {
    return labels;
  }
  return labels.map((label) =>
    label.sectorIndex === sectorIndex && label.prizeDisplayName !== finalName
      ? { ...label, prizeDisplayName: finalName }
      : label,
  );
}
