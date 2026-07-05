import { checkGifts, type GiftCheckInput } from "@/lib/promo/gift-engine";
import {
  BOOKING_PROMO_GENERAL_NOTICE,
  calculatePrice,
  getConfirmStepPromoRules,
  getPromoMessage,
  getServiceCardPromoRules,
  type PromoRule,
} from "@/lib/promo/promo-engine";
import { formatPriceDisplay } from "@/lib/pricing/price-layer";
import {
  normalizePrimaryPromotion,
  normalizePromotion,
  type NormalizedPromotion,
} from "@/lib/promo/promotion-normalizer";

export { BOOKING_PROMO_GENERAL_NOTICE as BOOKING_RULES_GENERAL_NOTICE };

export type RulesEngineInput = {
  serviceId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  clientId?: string | null;
  isFirstVisit?: boolean;
  basePrice?: number | null;
  /** Верхняя граница диапазона; если не задана — совпадает с basePrice. */
  priceMax?: number | null;
};

export type RulesEnginePromo = {
  type: "DISCOUNT" | "INFO";
  message: string;
};

export type RulesEngineGift = {
  serviceId: string;
  title: string;
};

export type RulesEngineConfirmSection = {
  id: string;
  title: string;
  description: string;
};

export type RulesEngineResult = {
  price: {
    original: number | null;
    final: number | null;
    originalLabel: string | null;
    finalLabel: string | null;
  };
  promos: RulesEnginePromo[];
  gifts: RulesEngineGift[];
  confirmSections: RulesEngineConfirmSection[];
};

export type { NormalizedPromotion, RulesEngineServiceCardDisplay } from "@/lib/promo/promotion-normalizer";

function toPromoClient(input: RulesEngineInput) {
  return {
    isFirstVisit: input.isFirstVisit,
  };
}

function toPromoPriceInput(input: RulesEngineInput) {
  const base = input.basePrice ?? null;
  const max = input.priceMax ?? base;

  return {
    serviceId: input.serviceId,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    priceFrom: base,
    priceTo: max,
  };
}

function toGiftInput(input: RulesEngineInput): GiftCheckInput {
  return {
    serviceId: input.serviceId,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    clientId: input.clientId,
    isFirstVisit: input.isFirstVisit,
  };
}

function formatPriceLabels(
  from: number | null,
  to: number | null,
): string | null {
  return formatPriceDisplay(from, to);
}

function mapPromoType(rule: PromoRule): RulesEnginePromo["type"] {
  if (
    rule.discountPercent != null ||
    rule.fixedDiscount != null ||
    rule.type === "FIRST_VISIT" ||
    rule.type === "TIME_LIMITED" ||
    rule.type === "SERVICE" ||
    rule.type === "CATEGORY"
  ) {
    return "DISCOUNT";
  }
  return "INFO";
}

function mapConfirmSections(rules: PromoRule[]): RulesEngineConfirmSection[] {
  return rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    description: rule.description,
  }));
}

/** Единая точка расчёта цены, акций и подарков для booking. */
export function evaluateBookingRules(input: RulesEngineInput): RulesEngineResult {
  const client = toPromoClient(input);
  const priceResult = calculatePrice(toPromoPriceInput(input), client);
  const gifts = checkGifts(toGiftInput(input));
  const confirmRules = getConfirmStepPromoRules(toPromoPriceInput(input), client);

  const promos: RulesEnginePromo[] = priceResult.appliedPromos
    .filter(({ rule }) => rule.type !== "GIFT")
    .map(({ rule, message }) => ({
      type: mapPromoType(rule),
      message,
    }));

  for (const gift of gifts) {
    promos.push({
      type: "INFO",
      message: gift.title,
    });
  }

  const originalLabel = formatPriceLabels(
    priceResult.originalPriceFrom,
    priceResult.originalPriceTo,
  );
  const computedFinalLabel = formatPriceLabels(
    priceResult.finalPriceFrom,
    priceResult.finalPriceTo,
  );
  const hasDiscount =
    priceResult.originalPrice != null &&
    priceResult.finalPrice != null &&
    priceResult.finalPrice !== priceResult.originalPrice;

  return {
    price: {
      original: priceResult.originalPrice,
      final: priceResult.finalPrice,
      originalLabel,
      finalLabel:
        hasDiscount && computedFinalLabel !== originalLabel
          ? computedFinalLabel
          : originalLabel,
    },
    promos,
    gifts,
    confirmSections: mapConfirmSections(confirmRules),
  };
}

/** Карточки услуг: только через rules-engine. */
export function evaluateServiceCardRules(
  input: RulesEngineInput,
): NormalizedPromotion[] {
  const rules = getServiceCardPromoRules(
    toPromoPriceInput(input),
    toPromoClient(input),
  );

  return rules.map((rule) => normalizePromotion(rule));
}

export function getServiceCardPromoDisplay(
  input: RulesEngineInput,
): NormalizedPromotion {
  return normalizePrimaryPromotion(evaluateServiceCardRules(input));
}

export function getPrimaryPromoMessage(result: RulesEngineResult): string | null {
  return result.promos[0]?.message ?? null;
}

export { getPromoMessage };
