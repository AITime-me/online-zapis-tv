import {
  getPromoMessage,
  PROMO_RULES,
  type PromoRule,
  type PromoRuleType,
} from "@/lib/promo/promo-engine";
import { GIFT_RULES, type GiftRule } from "@/lib/promo/gift-engine";
import { formatSchedulePromoBadgeLabel } from "@/lib/schedule/appointment-display";

export type PromotionAdminKind = "DISCOUNT" | "GIFT";

export type PromotionAdminStatus = "active" | "inactive";

export type PromotionAdminCondition =
  | "first_visit"
  | "service"
  | "category"
  | "manual"
  | "time_limited";

export type PromotionAdminRule = {
  id: string;
  name: string;
  kind: PromotionAdminKind;
  status: PromotionAdminStatus;
  condition: PromotionAdminCondition;
  conditionLabel: string;
  appliesTo: string;
  clientText: string;
  scheduleText: string;
  valueLabel: string;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string | null;
  source: "promo-engine" | "gift-engine";
};

function dash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || "—";
}

function mapPromoConditionType(type: PromoRuleType): PromotionAdminCondition {
  switch (type) {
    case "FIRST_VISIT":
      return "first_visit";
    case "SERVICE":
      return "service";
    case "CATEGORY":
      return "category";
    case "TIME_LIMITED":
      return "time_limited";
    default:
      return "manual";
  }
}

function mapPromoConditionLabel(rule: PromoRule): string {
  switch (rule.type) {
    case "FIRST_VISIT":
      return "Первый визит";
    case "SERVICE":
      return "Услуга";
    case "CATEGORY":
      return "Категория";
    case "TIME_LIMITED":
      return "Ограничена по времени";
    default:
      return "Ручная акция";
  }
}

function mapPromoAppliesTo(rule: PromoRule): string {
  if (rule.serviceId) {
    return `Услуга (${rule.serviceId.slice(0, 8)}…)`;
  }
  if (rule.categoryName?.trim()) {
    return `Категория: ${rule.categoryName.trim()}`;
  }
  if (rule.categoryId) {
    return `Категория (${rule.categoryId.slice(0, 8)}…)`;
  }
  return "—";
}

function mapPromoValueLabel(rule: PromoRule): string {
  if (rule.discountPercent != null) {
    return `${rule.discountPercent}%`;
  }
  if (rule.fixedDiscount != null) {
    return `${rule.fixedDiscount.toLocaleString("ru-RU")} ₽`;
  }
  return "—";
}

function mapPromoDisplayName(rule: PromoRule): string {
  if (rule.id === "cold-plasma-first-visit-30") {
    return "Скидка 30% на первую холодную плазму";
  }
  return rule.title.trim();
}

function mapPromoClientText(rule: PromoRule): string {
  return dash(rule.description || rule.cardShortText || rule.badgeText);
}

function mapPromoScheduleText(rule: PromoRule): string {
  return formatSchedulePromoBadgeLabel(getPromoMessage(rule));
}

function mapPromoRule(rule: PromoRule): PromotionAdminRule {
  return {
    id: rule.id,
    name: mapPromoDisplayName(rule),
    kind: "DISCOUNT",
    status: rule.isActive ? "active" : "inactive",
    condition: mapPromoConditionType(rule.type),
    conditionLabel: mapPromoConditionLabel(rule),
    appliesTo: mapPromoAppliesTo(rule),
    clientText: mapPromoClientText(rule),
    scheduleText: mapPromoScheduleText(rule),
    valueLabel: mapPromoValueLabel(rule),
    startDate: rule.startDate ?? null,
    endDate: rule.endDate ?? null,
    updatedAt: null,
    source: "promo-engine",
  };
}

function mapGiftAppliesTo(rule: GiftRule): string {
  if (rule.triggerServiceId) {
    return `При записи на услугу (${rule.triggerServiceId.slice(0, 8)}…)`;
  }
  if (rule.categoryName?.trim()) {
    return `Категория: ${rule.categoryName.trim()}`;
  }
  if (rule.categoryId) {
    return `Категория (${rule.categoryId.slice(0, 8)}…)`;
  }
  return "—";
}

function mapGiftRule(rule: GiftRule): PromotionAdminRule {
  const scheduleText = formatSchedulePromoBadgeLabel(rule.title);

  return {
    id: rule.id,
    name: rule.title.trim(),
    kind: "GIFT",
    status: rule.isActive ? "active" : "inactive",
    condition: rule.categoryName || rule.categoryId ? "category" : "service",
    conditionLabel: rule.categoryName || rule.categoryId ? "Категория" : "Услуга",
    appliesTo: mapGiftAppliesTo(rule),
    clientText: dash(rule.title),
    scheduleText,
    valueLabel: dash(rule.title),
    startDate: rule.startDate ?? null,
    endDate: rule.endDate ?? null,
    updatedAt: null,
    source: "gift-engine",
  };
}

/**
 * Список правил для админки — только реально работающие правила
 * из promo-engine и gift-engine (без заглушек).
 */
export function listPromotionRulesForAdmin(): PromotionAdminRule[] {
  return [...PROMO_RULES.map(mapPromoRule), ...GIFT_RULES.map(mapGiftRule)];
}

export function getPromotionAdminSummary(rules: PromotionAdminRule[]) {
  return {
    total: rules.length,
    active: rules.filter((rule) => rule.status === "active").length,
    inactive: rules.filter((rule) => rule.status === "inactive").length,
  };
}
