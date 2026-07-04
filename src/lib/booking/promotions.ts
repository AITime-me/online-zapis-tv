export type BookingPromotionType = "discount" | "gift" | "info";

export type BookingPromotion = {
  id: string;
  title: string;
  description: string;
  /** Короткий текст на карточке услуги. */
  cardShortText?: string;
  badgeText: string;
  type: BookingPromotionType;
  discountPercent?: number;
  serviceIds?: string[];
  categoryNames?: string[];
  startsAt?: string;
  endsAt?: string;
  showOnServiceCard: boolean;
  showOnConfirmStep: boolean;
};

export type BookingPromotionContext = {
  serviceId: string;
  categoryName?: string | null;
};

/** Общий текст про акции на первом шаге онлайн-записи. */
export const BOOKING_PROMOTIONS_GENERAL_NOTICE =
  "Если процедура участвует в акции, в онлайн-записи указана полная стоимость. Акционную цену или подарок мы применим при визите в студию.";

export const BOOKING_PROMOTIONS: BookingPromotion[] = [
  {
    id: "cold-plasma-first-visit-30",
    title: "Скидка на первый визит",
    description:
      "На первую процедуру холодной плазмы действует скидка 30%. В онлайн-записи указана полная стоимость. Если вы приходите на холодную плазму впервые, мы пересчитаем цену при визите в студию.",
    cardShortText:
      "-30% на первую процедуру. Цена в записи указана полная, скидку пересчитаем при визите.",
    badgeText: "-30% на первую процедуру",
    type: "discount",
    discountPercent: 30,
    categoryNames: ["Холодная плазма"],
    showOnServiceCard: true,
    showOnConfirmStep: true,
  },
];

function isPromotionActive(
  promotion: BookingPromotion,
  now: Date = new Date(),
): boolean {
  if (promotion.startsAt && now < new Date(promotion.startsAt)) {
    return false;
  }
  if (promotion.endsAt && now > new Date(promotion.endsAt)) {
    return false;
  }
  return true;
}

function promotionMatches(
  promotion: BookingPromotion,
  context: BookingPromotionContext,
): boolean {
  if (promotion.serviceIds?.includes(context.serviceId)) {
    return true;
  }

  if (!context.categoryName || !promotion.categoryNames?.length) {
    return false;
  }

  const normalizedCategory = context.categoryName.trim().toLowerCase();
  return promotion.categoryNames.some(
    (name) => name.trim().toLowerCase() === normalizedCategory,
  );
}

export function getActivePromotionsForBooking(
  context: BookingPromotionContext,
  now: Date = new Date(),
): BookingPromotion[] {
  return BOOKING_PROMOTIONS.filter(
    (promotion) =>
      isPromotionActive(promotion, now) && promotionMatches(promotion, context),
  );
}

export function getServiceCardPromotions(
  context: BookingPromotionContext,
): BookingPromotion[] {
  return getActivePromotionsForBooking(context).filter(
    (promotion) => promotion.showOnServiceCard,
  );
}

export function getConfirmStepPromotions(
  context: BookingPromotionContext,
): BookingPromotion[] {
  return getActivePromotionsForBooking(context).filter(
    (promotion) => promotion.showOnConfirmStep,
  );
}
