import type { PromotionDto } from "@/types/promotion-admin";

export type PromotionHomepageReadiness = {
  eligible: boolean;
  missing: string[];
};

export function getPromotionHomepageReadiness(
  promotion: Pick<
    PromotionDto,
    | "title"
    | "shortDescription"
    | "description"
    | "ctaText"
    | "ctaLink"
    | "imageUrl"
    | "status"
    | "isActive"
    | "showOnHomepage"
    | "startsAt"
    | "endsAt"
  >,
  now = new Date(),
): PromotionHomepageReadiness {
  const missing: string[] = [];

  if (!promotion.title.trim()) {
    missing.push("заголовок");
  }

  const description =
    promotion.shortDescription?.trim() || promotion.description?.trim() || "";
  if (!description) {
    missing.push("краткое описание или описание");
  }

  if (!promotion.ctaLink?.trim()) {
    missing.push("ссылка CTA");
  }

  if (!promotion.ctaText?.trim()) {
    missing.push("текст CTA");
  }

  if (promotion.status !== "active") {
    missing.push("статус «Активна»");
  }

  if (!promotion.isActive) {
    missing.push("флаг «Активна»");
  }

  if (!promotion.showOnHomepage) {
    missing.push("флаг «Показывать на главной»");
  }

  if (promotion.startsAt && new Date(promotion.startsAt) > now) {
    missing.push("дата начала ещё не наступила");
  }

  if (promotion.endsAt && new Date(promotion.endsAt) < now) {
    missing.push("дата окончания уже прошла");
  }

  return {
    eligible: missing.length === 0,
    missing,
  };
}

export function isPromotionEligibleForHomepageCarousel(
  promotion: PromotionDto,
  now = new Date(),
): boolean {
  return getPromotionHomepageReadiness(promotion, now).eligible;
}
