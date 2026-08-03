import "server-only";

import { parsePrizeRules, prizeRulesToJson } from "@/lib/game/wheel/prize-rules-contract";
import type { PrizeRulesV1 } from "@/lib/game/wheel/prize-rules-contract";
import { isGamePrizeType, type GamePrizeType } from "@/lib/game/wheel/prize-types";
import type { WheelServerAssignmentV1 } from "@/lib/game/wheel/wheel-assignment-contract";

export type WheelFrozenPrizeGiftV1 = {
  giftId: string;
  prizeSystemKey: string;
  displayName: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  prizeType: GamePrizeType;
  prizeRules: PrizeRulesV1;
  activationMode: "SINGLE_PAID_SERVICE" | "COURSE_MIN_SESSIONS";
  minCourseSessions: number | null;
  activationConditionText: string;
};

export type WheelAssignmentPrizeSnapshotV1 = {
  version: 1;
  original: WheelFrozenPrizeGiftV1;
  replacementFallback: WheelFrozenPrizeGiftV1 | null;
};

export type WheelPrizeCatalogGift = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  isActive: boolean;
  probability: number;
  systemKey: string | null;
  sortOrder: number;
  prizeType: string | null;
  prizeRules: unknown;
  activationMode: "SINGLE_PAID_SERVICE" | "COURSE_MIN_SESSIONS";
  minCourseSessions: number | null;
  activationConditionText: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeGift(gift: WheelPrizeCatalogGift): WheelFrozenPrizeGiftV1 | null {
  if (!gift.systemKey?.trim()) {
    return null;
  }
  const prizeType = isGamePrizeType(gift.prizeType) ? gift.prizeType : null;
  const prizeRules = parsePrizeRules(gift.prizeRules);
  if (!prizeType || !prizeRules) {
    return null;
  }
  return {
    giftId: gift.id,
    prizeSystemKey: gift.systemKey.trim(),
    displayName: gift.name.trim(),
    shortDescription: gift.shortDescription,
    image: gift.image,
    priority: gift.priority,
    cardStyle: gift.cardStyle,
    prizeType,
    prizeRules,
    activationMode: gift.activationMode,
    minCourseSessions: gift.minCourseSessions,
    activationConditionText: gift.activationConditionText,
  };
}

export function buildWheelAssignmentPrizeSnapshot(
  winnerGiftId: string,
  catalog: WheelPrizeCatalogGift[],
): WheelAssignmentPrizeSnapshotV1 | null {
  const winner = catalog.find((gift) => gift.id === winnerGiftId);
  if (!winner) {
    return null;
  }
  const original = freezeGift(winner);
  if (!original) {
    return null;
  }

  const fallbackKey = original.prizeRules.replacement?.fallbackSystemKey ?? null;
  const fallbackGift = fallbackKey
    ? (catalog.find((gift) => gift.systemKey === fallbackKey) ?? null)
    : null;
  const replacementFallback = fallbackGift ? freezeGift(fallbackGift) : null;

  return {
    version: 1,
    original,
    replacementFallback,
  };
}

export function parseWheelAssignmentPrizeSnapshot(
  raw: unknown,
): WheelAssignmentPrizeSnapshotV1 | null {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return null;
  }

  function parseFrozen(value: unknown): WheelFrozenPrizeGiftV1 | null {
    if (!isPlainObject(value)) {
      return null;
    }
    const prizeType = isGamePrizeType(value.prizeType) ? value.prizeType : null;
    const prizeRules = parsePrizeRules(value.prizeRules);
    if (
      typeof value.giftId !== "string" ||
      !value.giftId.trim() ||
      typeof value.prizeSystemKey !== "string" ||
      !value.prizeSystemKey.trim() ||
      typeof value.displayName !== "string" ||
      !value.displayName.trim() ||
      typeof value.shortDescription !== "string" ||
      typeof value.priority !== "string" ||
      typeof value.cardStyle !== "string" ||
      typeof value.activationConditionText !== "string" ||
      (value.activationMode !== "SINGLE_PAID_SERVICE" &&
        value.activationMode !== "COURSE_MIN_SESSIONS") ||
      !prizeType ||
      !prizeRules
    ) {
      return null;
    }
    return {
      giftId: value.giftId.trim(),
      prizeSystemKey: value.prizeSystemKey.trim(),
      displayName: value.displayName.trim(),
      shortDescription: value.shortDescription,
      image: typeof value.image === "string" ? value.image : null,
      priority: value.priority,
      cardStyle: value.cardStyle,
      prizeType,
      prizeRules,
      activationMode: value.activationMode,
      minCourseSessions:
        typeof value.minCourseSessions === "number"
          ? value.minCourseSessions
          : null,
      activationConditionText: value.activationConditionText,
    };
  }

  const original = parseFrozen(raw.original);
  if (!original) {
    return null;
  }

  const replacementFallback =
    raw.replacementFallback === null
      ? null
      : parseFrozen(raw.replacementFallback);
  if (raw.replacementFallback !== null && !replacementFallback) {
    return null;
  }

  return {
    version: 1,
    original,
    replacementFallback,
  };
}

export function enrichWheelAssignmentWithPrizeSnapshot(
  assignment: Omit<WheelServerAssignmentV1, "prizeSnapshot">,
  catalog: WheelPrizeCatalogGift[],
): WheelServerAssignmentV1 | null {
  const prizeSnapshot = buildWheelAssignmentPrizeSnapshot(
    assignment.giftId,
    catalog,
  );
  if (!prizeSnapshot) {
    return null;
  }
  return {
    ...assignment,
    prizeSnapshot,
  };
}

/** Minimal assignment builder for security scripts and unit tests. */
export function buildTestWheelServerAssignment(input: {
  sectorIndex: number;
  giftId: string;
  prizeSystemKey: string;
  prizeSnapshot: WheelAssignmentPrizeSnapshotV1;
  campaignKey?: string | null;
}): WheelServerAssignmentV1 {
  return {
    version: 1,
    mechanicType: "WHEEL_OF_FORTUNE",
    serverResultTier: 0,
    campaignKey: input.campaignKey ?? "permanent-wheel",
    rulesVersion: "1",
    assignedAt: "2026-08-03T10:00:00.000Z",
    tierBucket: "tier-0",
    sectorIndex: input.sectorIndex,
    totalSectors: 16,
    prizeSystemKey: input.prizeSystemKey,
    giftId: input.giftId,
    prizeSnapshot: input.prizeSnapshot,
  };
}

export function frozenPrizeRulesJson(rules: PrizeRulesV1): PrizeRulesV1 {
  return prizeRulesToJson(rules);
}
