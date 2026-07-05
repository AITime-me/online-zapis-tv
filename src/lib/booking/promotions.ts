/** Booking UI → rules-engine (единственный вход для акций в записи). */
export {
  BOOKING_RULES_GENERAL_NOTICE as BOOKING_PROMOTIONS_GENERAL_NOTICE,
  evaluateBookingRules,
  evaluateServiceCardRules,
  getPrimaryPromoMessage,
  getPromoMessage,
  getServiceCardPromoDisplay,
  type NormalizedPromotion,
  type RulesEngineConfirmSection,
  type RulesEngineGift,
  type RulesEngineInput,
  type RulesEnginePromo,
  type RulesEngineResult,
  type RulesEngineServiceCardDisplay,
} from "@/lib/promo/rules-engine";

export {
  EMPTY_PROMOTION,
  getPromotionBadge,
  getPromotionNote,
  normalizePrimaryPromotion,
  normalizePromotion,
  type PromotionInput,
} from "@/lib/promo/promotion-normalizer";

import {
  evaluateBookingRules,
  evaluateServiceCardRules,
  getServiceCardPromoDisplay,
  type NormalizedPromotion,
  type RulesEngineInput,
} from "@/lib/promo/rules-engine";
import {
  getPromotionBadge,
  getPromotionNote,
} from "@/lib/promo/promotion-normalizer";

/** @deprecated Используйте RulesEngineInput. */
export type BookingPromotionContext = {
  serviceId: string;
  categoryName?: string | null;
};

function toRulesInput(context: BookingPromotionContext): RulesEngineInput {
  return {
    serviceId: context.serviceId,
    categoryName: context.categoryName,
  };
}

/** @deprecated Используйте NormalizedPromotion. */
export type BookingPromotion = {
  id: string;
  title: string;
  description: string;
  badgeText?: string;
  cardShortText?: string;
};

export function getServiceCardPromotion(
  context: BookingPromotionContext,
): NormalizedPromotion {
  return getServiceCardPromoDisplay(toRulesInput(context));
}

export function getServiceCardPromotions(
  context: BookingPromotionContext,
): NormalizedPromotion[] {
  return evaluateServiceCardRules(toRulesInput(context));
}

export function getServiceCardPromoBadge(
  promotion: BookingPromotion | NormalizedPromotion | null | undefined,
): string {
  return getPromotionBadge(promotion);
}

export function getServiceCardPromoNote(
  promotion: BookingPromotion | NormalizedPromotion | null | undefined,
): string | null {
  return getPromotionNote(promotion);
}

export function getConfirmStepPromotions(
  context: BookingPromotionContext,
): BookingPromotion[] {
  return evaluateBookingRules(toRulesInput(context)).confirmSections.map(
    (section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
    }),
  );
}

export function getActivePromotionsForBooking(
  context: BookingPromotionContext,
): NormalizedPromotion[] {
  return getServiceCardPromotions(context);
}
