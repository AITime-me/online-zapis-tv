import {
  getStudioNow,
  normalizeDate,
} from "@/lib/datetime/date-layer";

export type GiftRule = {
  id: string;
  title: string;
  /** Услуга-подарок (если отличается от триггерной). */
  serviceId: string;
  triggerServiceId?: string;
  categoryId?: string;
  categoryName?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
};

export type GiftCheckInput = {
  serviceId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  clientId?: string | null;
  isFirstVisit?: boolean;
};

export type GiftOffer = {
  serviceId: string;
  title: string;
};

/** Реестр подарков. */
export const GIFT_RULES: GiftRule[] = [];

function normalizeCategory(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isGiftRuleActive(rule: GiftRule, now: Date = getStudioNow()): boolean {
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

function giftRuleMatches(
  rule: GiftRule,
  input: GiftCheckInput,
  now: Date = getStudioNow(),
): boolean {
  if (!isGiftRuleActive(rule, now)) {
    return false;
  }

  if (rule.triggerServiceId && rule.triggerServiceId !== input.serviceId) {
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

export function checkGifts(
  input: GiftCheckInput,
  now: Date = getStudioNow(),
): GiftOffer[] {
  return GIFT_RULES.filter((rule) => giftRuleMatches(rule, input, now)).map(
    (rule) => ({
      serviceId: rule.serviceId,
      title: rule.title,
    }),
  );
}
