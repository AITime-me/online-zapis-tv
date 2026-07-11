import type { AppliedPromotionRecord } from "@/types/applied-promotion";

function formatStoredPromotionLabel(promotion: AppliedPromotionRecord): string {
  const label = promotion.label.trim();
  if (!label) {
    return promotion.type.includes("GIFT") ? "Подарок" : "Акция";
  }

  if (promotion.type.includes("GIFT")) {
    if (/^подарок\s*:/i.test(label)) {
      return label;
    }
    return `Подарок: ${label}`;
  }

  if (/^акция\s*:/i.test(label)) {
    return label;
  }

  return `Акция: ${label}`;
}

/** Безопасные короткие подписи акций/подарков для MASTER DTO. */
export function buildPromotionLabels(
  promotions: AppliedPromotionRecord[],
): string[] {
  const labels: string[] = [];

  for (const promotion of promotions) {
    const label = formatStoredPromotionLabel(promotion).trim();
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }

  return labels;
}
