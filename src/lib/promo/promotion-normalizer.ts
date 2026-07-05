import {
  getPromoMessage,
  type PromoRule,
} from "@/lib/promo/promo-engine";

export type RulesEngineServiceCardDisplay = {
  ruleId: string;
  badge: string;
  note: string | null;
};

type BookingPromotionLike = {
  id: string;
  title: string;
  description: string;
  badgeText?: string;
  cardShortText?: string;
};

export type PromotionInput =
  | PromoRule
  | BookingPromotionLike
  | RulesEngineServiceCardDisplay
  | null
  | undefined;

export type NormalizedPromotion = {
  isActive: boolean;
  id: string;
  badgeText: string;
  note: string | null;
  title: string;
  description: string;
};

export const EMPTY_PROMOTION: NormalizedPromotion = {
  isActive: false,
  id: "",
  badgeText: "",
  note: null,
  title: "",
  description: "",
};

function isPromoRule(input: PromotionInput): input is PromoRule {
  return (
    input != null &&
    typeof input === "object" &&
    "type" in input &&
    "isActive" in input
  );
}

function isServiceCardDisplay(
  input: PromotionInput,
): input is RulesEngineServiceCardDisplay {
  return (
    input != null &&
    typeof input === "object" &&
    "ruleId" in input &&
    "badge" in input
  );
}

function isBookingPromotion(input: PromotionInput): input is BookingPromotionLike {
  return (
    input != null &&
    typeof input === "object" &&
    "id" in input &&
    "title" in input &&
    !("type" in input)
  );
}

/** Любой promo input → безопасная структура для UI. */
export function normalizePromotion(input: PromotionInput): NormalizedPromotion {
  if (!input) {
    return EMPTY_PROMOTION;
  }

  if (isPromoRule(input)) {
    return {
      isActive: true,
      id: input.id,
      badgeText: input.badgeText ?? getPromoMessage(input),
      note: input.cardShortText ?? null,
      title: input.title,
      description: input.description,
    };
  }

  if (isServiceCardDisplay(input)) {
    return {
      isActive: true,
      id: input.ruleId,
      badgeText: input.badge,
      note: input.note,
      title: input.badge,
      description: input.note ?? "",
    };
  }

  if (isBookingPromotion(input)) {
    return {
      isActive: true,
      id: input.id,
      badgeText: input.badgeText ?? input.title,
      note: input.cardShortText ?? null,
      title: input.title,
      description: input.description,
    };
  }

  return EMPTY_PROMOTION;
}

/** Первая акция из списка или пустая заглушка. */
export function normalizePrimaryPromotion(
  items: PromotionInput[] | null | undefined,
): NormalizedPromotion {
  if (!items?.length) {
    return EMPTY_PROMOTION;
  }

  return normalizePromotion(items[0]);
}

export function getPromotionBadge(input: PromotionInput): string {
  return normalizePromotion(input).badgeText;
}

export function getPromotionNote(input: PromotionInput): string | null {
  return normalizePromotion(input).note;
}
