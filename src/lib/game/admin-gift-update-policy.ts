import type { GamePrizeType } from "@prisma/client";
import { parsePrizeRules } from "@/lib/game/wheel/prize-rules-contract";
import {
  validateWheelSectorConfiguration,
  type WheelSectorGift,
} from "@/lib/game/wheel/sector-assignment";
import { normalizePrizeType, normalizeSystemKey } from "@/lib/game/wheel/wheel-admin";

/** Business fields allowed for Wheel identity gifts via ordinary admin PATCH. */
export const WHEEL_GIFT_MUTABLE_BUSINESS_FIELDS = [
  "name",
  "shortDescription",
  "activationConditionText",
  "probability",
  "isActive",
] as const;

export type WheelGiftMutableBusinessField =
  (typeof WHEEL_GIFT_MUTABLE_BUSINESS_FIELDS)[number];

export function isWheelIdentityGift(gift: {
  systemKey: string | null;
  prizeType: GamePrizeType | null;
}): boolean {
  return gift.systemKey !== null || gift.prizeType !== null;
}

function sameStringArray(left: string[], right: unknown): boolean {
  if (!Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

/**
 * Reject crafted PATCH mutations outside the Wheel business allowlist.
 * Echo of unchanged activationMode / minCourseSessions is allowed for UI compat.
 * Identity fields (systemKey / prizeType / prizeRules / gameCatalogId) handled separately.
 */
export function assertWheelGiftUpdateAllowlist(input: {
  existing: {
    image: string | null;
    priority: string;
    cardStyle: string;
    allowedGameDirections: string[];
    allowedResultTypes: string[];
    requiredPremiumLevel: number;
    activationMode: string;
    minCourseSessions: number | null;
    sortOrder: number;
  };
  patch: Record<string, unknown>;
}): void {
  const { existing, patch } = input;

  if (patch.image !== undefined && (patch.image || null) !== existing.image) {
    throw new Error("Поле image нельзя изменить у приза Колеса фортуны");
  }
  if (patch.priority !== undefined && patch.priority !== existing.priority) {
    throw new Error("Поле priority нельзя изменить у приза Колеса фортуны");
  }
  if (patch.cardStyle !== undefined && patch.cardStyle !== existing.cardStyle) {
    throw new Error("Поле cardStyle нельзя изменить у приза Колеса фортуны");
  }
  if (
    patch.allowedGameDirections !== undefined &&
    !sameStringArray(existing.allowedGameDirections, patch.allowedGameDirections)
  ) {
    throw new Error(
      "Поле allowedGameDirections нельзя изменить у приза Колеса фортуны",
    );
  }
  if (
    patch.allowedResultTypes !== undefined &&
    !sameStringArray(existing.allowedResultTypes, patch.allowedResultTypes)
  ) {
    throw new Error(
      "Поле allowedResultTypes нельзя изменить у приза Колеса фортуны",
    );
  }
  if (
    patch.requiredPremiumLevel !== undefined &&
    Number(patch.requiredPremiumLevel) !== existing.requiredPremiumLevel
  ) {
    throw new Error(
      "Поле requiredPremiumLevel нельзя изменить у приза Колеса фортуны",
    );
  }
  if (
    patch.sortOrder !== undefined &&
    Number(patch.sortOrder) !== existing.sortOrder
  ) {
    throw new Error("Поле sortOrder нельзя изменить у приза Колеса фортуны");
  }
  if (
    patch.activationMode !== undefined &&
    patch.activationMode !== existing.activationMode
  ) {
    throw new Error(
      "Режим получения нельзя изменить у приза Колеса фортуны",
    );
  }
  if (patch.minCourseSessions !== undefined) {
    const next =
      patch.minCourseSessions === null || patch.minCourseSessions === ""
        ? null
        : Number(patch.minCourseSessions);
    if (next !== existing.minCourseSessions) {
      throw new Error(
        "minCourseSessions нельзя изменить у приза Колеса фортуны",
      );
    }
  }
}

export function assertWheelGiftIdentityImmutable(input: {
  existing: {
    systemKey: string | null;
    prizeType: GamePrizeType | null;
    prizeRules: unknown;
  };
  patch: {
    systemKey?: unknown;
    prizeType?: unknown;
    prizeRules?: unknown;
  };
}): void {
  if (input.patch.systemKey !== undefined) {
    const next = normalizeSystemKey(input.patch.systemKey);
    if (next !== input.existing.systemKey) {
      throw new Error("systemKey нельзя изменить у существующего подарка");
    }
  }
  if (input.patch.prizeType !== undefined) {
    const next = normalizePrizeType(input.patch.prizeType);
    if (next !== input.existing.prizeType) {
      throw new Error(
        "Тип приза нельзя изменить. Создайте новый подарок и отключите текущий.",
      );
    }
  }
  if (input.patch.prizeRules !== undefined) {
    const existingParsed = parsePrizeRules(input.existing.prizeRules);
    const nextParsed = parsePrizeRules(input.patch.prizeRules);
    if (JSON.stringify(nextParsed) !== JSON.stringify(existingParsed)) {
      throw new Error(
        "prizeRules нельзя изменить через обычное редактирование",
      );
    }
  }
}

/** True when a persisted session assignment still points at this gift id. */
export function serverAssignmentReferencesGiftId(
  serverAssignment: unknown,
  giftId: string,
): boolean {
  if (!serverAssignment || typeof serverAssignment !== "object" || Array.isArray(serverAssignment)) {
    return false;
  }
  const raw = serverAssignment as {
    giftId?: unknown;
    prizeSnapshot?: {
      original?: { giftId?: unknown };
      replacementFallback?: { giftId?: unknown } | null;
    };
    claimLock?: {
      originalPrize?: { giftId?: unknown };
      finalPrize?: { giftId?: unknown };
    };
  };
  if (raw.giftId === giftId) {
    return true;
  }
  if (raw.prizeSnapshot?.original?.giftId === giftId) {
    return true;
  }
  if (raw.prizeSnapshot?.replacementFallback?.giftId === giftId) {
    return true;
  }
  if (raw.claimLock?.originalPrize?.giftId === giftId) {
    return true;
  }
  if (raw.claimLock?.finalPrize?.giftId === giftId) {
    return true;
  }
  return false;
}

/**
 * Sector/active changes are written only when the future wheel stays valid,
 * or the catalog is already not ACTIVE (draft repair). An ACTIVE valid wheel
 * cannot be left invalid by a single-gift PATCH.
 */
export function assertFutureWheelSectorConfig(input: {
  catalogStatus: "ACTIVE" | "DRAFT" | "DISABLED" | "ARCHIVED";
  expectedSectorCount: number;
  currentGifts: WheelSectorGift[];
  nextGifts: WheelSectorGift[];
}): void {
  const next = validateWheelSectorConfiguration(
    input.nextGifts,
    input.expectedSectorCount,
  );
  if (next.ok) {
    return;
  }
  const current = validateWheelSectorConfiguration(
    input.currentGifts,
    input.expectedSectorCount,
  );
  if (input.catalogStatus === "ACTIVE" || current.ok) {
    throw new Error(
      next.error ||
        "Изменение оставит конфигурацию колеса невалидной. Сохраните сумму секторов.",
    );
  }
}
