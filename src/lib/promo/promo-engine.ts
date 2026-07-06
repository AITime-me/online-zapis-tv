import {
  getStudioNow,
  normalizeDate,
} from "@/lib/datetime/date-layer";
import { formatPriceDisplay } from "@/lib/pricing/price-layer";
import {
  getPromotionBadge,
  getPromotionNote,
} from "@/lib/promo/promotion-normalizer";

export type PromoRuleType =
  | "FIRST_VISIT"
  | "SERVICE"
  | "CATEGORY"
  | "TIME_LIMITED"
  | "GIFT";

export type PromoRule = {
  id: string;
  type: PromoRuleType;
  title: string;
  description: string;
  discountPercent?: number;
  fixedDiscount?: number;
  serviceId?: string;
  categoryId?: string;
  categoryName?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  showOnServiceCard?: boolean;
  showOnConfirmStep?: boolean;
  badgeText?: string;
  cardShortText?: string;
};

export type PromoPriceInput = {
  serviceId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  priceFrom?: number | null;
  priceTo?: number | null;
};

export type PromoClientContext = {
  /** Без данных с backend считаем клиента потенциально новым для показа FIRST_VISIT. */
  isFirstVisit?: boolean;
};

export type AppliedPromo = {
  rule: PromoRule;
  message: string;
};

export type PromoPriceResult = {
  originalPrice: number | null;
  finalPrice: number | null;
  originalPriceFrom: number | null;
  originalPriceTo: number | null;
  finalPriceFrom: number | null;
  finalPriceTo: number | null;
  originalPriceLabel: string | null;
  finalPriceLabel: string | null;
  appliedPromos: AppliedPromo[];
  message: string | null;
};

export const BOOKING_PROMO_GENERAL_NOTICE =
  "Если процедура участвует в акции, в онлайн-записи указана полная стоимость. Акционную цену или подарок мы применим при визите в студию.";

/** Единый реестр акций. */
export const PROMO_RULES: PromoRule[] = [
  {
    id: "cold-plasma-first-visit-30",
    type: "FIRST_VISIT",
    title: "Скидка на первый визит",
    description:
      "На первую процедуру холодной плазмы действует скидка 30%. В прайсе указана полная стоимость. Если это ваш первый визит на холодную плазму, мы применим скидку и подтвердим итоговую цену.",
    discountPercent: 30,
    categoryName: "Холодная плазма",
    isActive: true,
    showOnServiceCard: true,
    showOnConfirmStep: true,
    badgeText: "-30% на первую процедуру",
    cardShortText:
      "-30% на первую процедуру. В прайсе полная стоимость — при первом визите применим скидку и подтвердим итоговую цену.",
  },
];

function normalizeCategory(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isRuleActive(rule: PromoRule, now: Date = getStudioNow()): boolean {
  if (!rule.isActive) {
    return false;
  }

  const startsAt = rule.startDate ? normalizeDate(rule.startDate) : null;
  const endsAt = rule.endDate ? normalizeDate(rule.endDate) : null;

  if (startsAt && now < startsAt) {
    return false;
  }
  if (endsAt && now > endsAt) {
    return false;
  }

  return true;
}

function ruleMatchesInput(
  rule: PromoRule,
  input: PromoPriceInput,
  client: PromoClientContext,
): boolean {
  if (rule.type === "FIRST_VISIT" && client.isFirstVisit === false) {
    return false;
  }

  if (rule.serviceId && rule.serviceId !== input.serviceId) {
    return false;
  }

  if (rule.categoryId && rule.categoryId !== input.categoryId) {
    return false;
  }

  if (rule.categoryName) {
    const ruleCategory = normalizeCategory(rule.categoryName);
    const inputCategory = normalizeCategory(input.categoryName);
    if (!ruleCategory || ruleCategory !== inputCategory) {
      return false;
    }
  }

  return true;
}

export function getPromoMessage(rule: PromoRule): string {
  if (rule.type === "GIFT") {
    return rule.title || "Подарок при записи";
  }

  if (rule.discountPercent != null) {
    if (rule.type === "FIRST_VISIT") {
      return `Скидка ${rule.discountPercent}% для новых клиентов`;
    }
    if (rule.type === "TIME_LIMITED") {
      return `Акция −${rule.discountPercent}% действует до указанной даты`;
    }
    return `Скидка ${rule.discountPercent}%`;
  }

  if (rule.fixedDiscount != null) {
    return `Скидка ${rule.fixedDiscount.toLocaleString("ru-RU")} ₽`;
  }

  return rule.title;
}

export function checkPromos(
  input: PromoPriceInput,
  client: PromoClientContext = {},
  now: Date = getStudioNow(),
): PromoRule[] {
  return PROMO_RULES.filter(
    (rule) => isRuleActive(rule, now) && ruleMatchesInput(rule, input, client),
  );
}

function resolveOriginalPrices(input: PromoPriceInput): {
  from: number | null;
  to: number | null;
} {
  return {
    from: input.priceFrom ?? input.priceTo ?? null,
    to: input.priceTo ?? input.priceFrom ?? null,
  };
}

function applyRuleDiscount(amount: number, rule: PromoRule): number {
  if (rule.discountPercent != null) {
    return Math.max(0, Math.round(amount * (1 - rule.discountPercent / 100)));
  }
  if (rule.fixedDiscount != null) {
    return Math.max(0, amount - rule.fixedDiscount);
  }
  return amount;
}

function formatPriceLabel(from: number | null, to: number | null): string | null {
  return formatPriceDisplay(from, to);
}

function pickBestDiscountRule(rules: PromoRule[]): PromoRule | null {
  const discountRules = rules.filter(
    (rule) => rule.discountPercent != null || rule.fixedDiscount != null,
  );
  if (discountRules.length === 0) {
    return null;
  }

  return discountRules.reduce((best, current) => {
    const bestPercent = best.discountPercent ?? 0;
    const currentPercent = current.discountPercent ?? 0;
    if (currentPercent !== bestPercent) {
      return currentPercent > bestPercent ? current : best;
    }
    const bestFixed = best.fixedDiscount ?? 0;
    const currentFixed = current.fixedDiscount ?? 0;
    return currentFixed > bestFixed ? current : best;
  });
}

export function calculatePrice(
  input: PromoPriceInput,
  client: PromoClientContext = {},
  now: Date = getStudioNow(),
): PromoPriceResult {
  const matchedRules = checkPromos(input, client, now);
  const appliedPromos: AppliedPromo[] = matchedRules.map((rule) => ({
    rule,
    message: getPromoMessage(rule),
  }));

  const { from, to } = resolveOriginalPrices(input);
  const originalPriceLabel = formatPriceLabel(from, to);

  if (from == null && to == null) {
    return {
      originalPrice: null,
      finalPrice: null,
      originalPriceFrom: null,
      originalPriceTo: null,
      finalPriceFrom: null,
      finalPriceTo: null,
      originalPriceLabel,
      finalPriceLabel: originalPriceLabel,
      appliedPromos,
      message: appliedPromos[0]?.message ?? null,
    };
  }

  const discountRule = pickBestDiscountRule(matchedRules);
  const finalFrom = from != null && discountRule ? applyRuleDiscount(from, discountRule) : from;
  const finalTo =
    to != null && discountRule
      ? applyRuleDiscount(to, discountRule)
      : to ?? finalFrom;

  const finalPriceLabel = formatPriceLabel(finalFrom, finalTo);
  const representativeOriginal = from ?? to;
  const representativeFinal = finalFrom ?? finalTo;

  return {
    originalPrice: representativeOriginal,
    finalPrice:
      discountRule && representativeOriginal != null && representativeFinal != null
        ? representativeFinal
        : representativeOriginal,
    originalPriceFrom: from,
    originalPriceTo: to,
    finalPriceFrom: finalFrom,
    finalPriceTo: finalTo,
    originalPriceLabel,
    finalPriceLabel:
      discountRule && finalPriceLabel !== originalPriceLabel
        ? finalPriceLabel
        : originalPriceLabel,
    appliedPromos,
    message: appliedPromos[0]?.message ?? null,
  };
}

export function getServiceCardPromoRules(
  input: PromoPriceInput,
  client: PromoClientContext = {},
): PromoRule[] {
  return checkPromos(input, client).filter((rule) => rule.showOnServiceCard);
}

export function getConfirmStepPromoRules(
  input: PromoPriceInput,
  client: PromoClientContext = {},
): PromoRule[] {
  return checkPromos(input, client).filter((rule) => rule.showOnConfirmStep);
}

export function getServiceCardPromoBadge(
  rule: PromoRule | null | undefined,
): string {
  return getPromotionBadge(rule);
}

export function getServiceCardPromoNote(
  rule: PromoRule | null | undefined,
): string | null {
  return getPromotionNote(rule);
}
