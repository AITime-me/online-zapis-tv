import type { GameCatalogType } from "@prisma/client";
import type { GameMechanicTypeDto } from "@/lib/game/session/game-session-contract";

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
  };
}
