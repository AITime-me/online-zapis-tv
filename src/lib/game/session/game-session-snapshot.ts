import type { GameCatalogType } from "@prisma/client";
import type { GameMechanicTypeDto } from "@/lib/game/session/game-session-contract";
import {
  ACTIVATION_CONDITION_TEXT_MAX_LENGTH,
  buildGiftActivationSnapshotFields,
  generateActivationConditionText,
  GIFT_VALIDITY_DAYS,
  isGameGiftActivationMode,
  LEGACY_ACTIVATION_CONDITION_TEXT,
  type GameGiftActivationMode,
} from "@/lib/game/gift-activation";

export type GiftSnapshot = {
  giftId: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  ruleType: "weighted_pool";
  assignedValue: string | null;
  assignedAt: string;
  /**
   * New snapshots always set a business mode.
   * Legacy snapshots without activation fields keep null (unspecified).
   */
  activationMode: GameGiftActivationMode | null;
  minCourseSessions: number | null;
  activationConditionText: string;
  validityDays: number;
};

export type RulesSnapshot = {
  campaignKey: string | null;
  rulesVersion: string;
  mechanicType: GameMechanicTypeDto;
  serverResultTier: number;
  probabilityBucket: string;
  bookingWindowHours: number;
  catalogSlug: string;
  catalogTitle: string;
};

export type GiftSnapshotSource = {
  id: string;
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
};

export function mechanicTypeFromCatalog(
  type: GameCatalogType,
): GameMechanicTypeDto {
  if (type === "WHEEL_OF_FORTUNE") {
    return "WHEEL_OF_FORTUNE";
  }
  return "CATCH_TIME";
}

export function buildGiftSnapshot(
  gift: GiftSnapshotSource,
  assignedAt: Date,
): GiftSnapshot {
  const activation = buildGiftActivationSnapshotFields(gift);

  return {
    giftId: gift.id,
    name: gift.name,
    shortDescription: gift.shortDescription,
    image: gift.image ?? null,
    priority: gift.priority,
    cardStyle: gift.cardStyle,
    ruleType: "weighted_pool",
    assignedValue: null,
    assignedAt: assignedAt.toISOString(),
    activationMode: activation.activationMode,
    minCourseSessions: activation.minCourseSessions,
    activationConditionText: activation.activationConditionText,
    validityDays: activation.validityDays,
  };
}

export function buildRulesSnapshot(input: {
  campaignKey: string | null;
  rulesVersion: string;
  mechanicType: GameMechanicTypeDto;
  serverResultTier: number;
  catalogSlug: string;
  catalogTitle: string;
  bookingWindowHours: number;
}): RulesSnapshot {
  return {
    campaignKey: input.campaignKey,
    rulesVersion: input.rulesVersion,
    mechanicType: input.mechanicType,
    serverResultTier: input.serverResultTier,
    probabilityBucket: `tier-${input.serverResultTier}`,
    bookingWindowHours: input.bookingWindowHours,
    catalogSlug: input.catalogSlug,
    catalogTitle: input.catalogTitle,
  };
}

export function publicGiftFromSnapshot(
  snapshot: GiftSnapshot | null | undefined,
): {
  name: string;
  shortDescription: string;
  image: string | null;
  priority: string;
  cardStyle: string;
  activationConditionText: string;
  validityDays: number;
} | null {
  if (!snapshot) {
    return null;
  }

  return {
    name: snapshot.name,
    shortDescription: snapshot.shortDescription,
    image: snapshot.image ?? null,
    priority: snapshot.priority,
    cardStyle: snapshot.cardStyle,
    activationConditionText: snapshot.activationConditionText,
    validityDays: snapshot.validityDays,
  };
}

export function parseRulesSnapshot(value: unknown): RulesSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<RulesSnapshot>;
  if (
    typeof snapshot.rulesVersion !== "string" ||
    typeof snapshot.mechanicType !== "string" ||
    typeof snapshot.serverResultTier !== "number" ||
    typeof snapshot.probabilityBucket !== "string" ||
    typeof snapshot.bookingWindowHours !== "number" ||
    typeof snapshot.catalogSlug !== "string" ||
    typeof snapshot.catalogTitle !== "string"
  ) {
    return null;
  }

  return {
    campaignKey: snapshot.campaignKey ?? null,
    rulesVersion: snapshot.rulesVersion,
    mechanicType: snapshot.mechanicType,
    serverResultTier: snapshot.serverResultTier,
    probabilityBucket: snapshot.probabilityBucket,
    bookingWindowHours: snapshot.bookingWindowHours,
    catalogSlug: snapshot.catalogSlug,
    catalogTitle: snapshot.catalogTitle,
  };
}

function clampConditionText(text: string): string {
  if (text.length <= ACTIVATION_CONDITION_TEXT_MAX_LENGTH) {
    return text;
  }
  return text.slice(0, ACTIVATION_CONDITION_TEXT_MAX_LENGTH);
}

function resolveActivationFromPartial(
  snapshot: Partial<GiftSnapshot>,
): {
  activationMode: GameGiftActivationMode | null;
  minCourseSessions: number | null;
  activationConditionText: string;
  validityDays: number;
} {
  const hasExplicitMode = isGameGiftActivationMode(snapshot.activationMode);
  if (!hasExplicitMode) {
    const hasExplicitText =
      typeof snapshot.activationConditionText === "string" &&
      snapshot.activationConditionText.trim().length > 0;
    return {
      activationMode: null,
      minCourseSessions: null,
      activationConditionText: clampConditionText(
        hasExplicitText
          ? snapshot.activationConditionText!.trim()
          : LEGACY_ACTIVATION_CONDITION_TEXT,
      ),
      validityDays:
        typeof snapshot.validityDays === "number" &&
        Number.isFinite(snapshot.validityDays) &&
        snapshot.validityDays > 0
          ? Math.trunc(snapshot.validityDays)
          : GIFT_VALIDITY_DAYS,
    };
  }

  const mode = snapshot.activationMode as GameGiftActivationMode;
  const minCourseSessions =
    mode === "COURSE_MIN_SESSIONS"
      ? typeof snapshot.minCourseSessions === "number" &&
        Number.isFinite(snapshot.minCourseSessions) &&
        snapshot.minCourseSessions > 0
        ? Math.trunc(snapshot.minCourseSessions)
        : 5
      : null;
  const hasExplicitText =
    typeof snapshot.activationConditionText === "string" &&
    snapshot.activationConditionText.trim().length > 0;
  const text = clampConditionText(
    hasExplicitText
      ? snapshot.activationConditionText!.trim()
      : generateActivationConditionText(mode, minCourseSessions),
  );
  const validityDays =
    typeof snapshot.validityDays === "number" &&
    Number.isFinite(snapshot.validityDays) &&
    snapshot.validityDays > 0
      ? Math.trunc(snapshot.validityDays)
      : GIFT_VALIDITY_DAYS;

  return {
    activationMode: mode,
    minCourseSessions,
    activationConditionText: text,
    validityDays,
  };
}

export function parseGiftSnapshot(value: unknown): GiftSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<GiftSnapshot>;
  if (
    typeof snapshot.giftId !== "string" ||
    typeof snapshot.name !== "string" ||
    typeof snapshot.shortDescription !== "string" ||
    typeof snapshot.priority !== "string" ||
    typeof snapshot.cardStyle !== "string" ||
    typeof snapshot.assignedAt !== "string"
  ) {
    return null;
  }

  const activation = resolveActivationFromPartial(snapshot);

  return {
    giftId: snapshot.giftId,
    name: snapshot.name,
    shortDescription: snapshot.shortDescription,
    image: snapshot.image ?? null,
    priority: snapshot.priority,
    cardStyle: snapshot.cardStyle,
    ruleType: "weighted_pool",
    assignedValue: snapshot.assignedValue ?? null,
    assignedAt: snapshot.assignedAt,
    activationMode: activation.activationMode,
    minCourseSessions: activation.minCourseSessions,
    activationConditionText: activation.activationConditionText,
    validityDays: activation.validityDays,
  };
}
