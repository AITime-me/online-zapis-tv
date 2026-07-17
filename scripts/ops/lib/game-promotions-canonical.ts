/**
 * Нейтральный канон 4 подарков Catch-Time и витринной скидки −30%.
 * Общий источник для staging restore и production bootstrap.
 * Без environment guards и без @/-алиасов (копируется в migrator).
 */

export const PROCEDURE_GIFT_CATALOG_SLUG = "procedure-gift" as const;

export const CANONICAL_GIFT_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;

export type CanonicalGiftSeed = {
  id: (typeof CANONICAL_GIFT_IDS)[number];
  name: string;
  shortDescription: string;
  probability: number;
  priority: string;
  cardStyle: string;
  requiredPremiumLevel: number;
  allowedGameDirections: string[];
  allowedResultTypes: string[];
  isActive: true;
};

/** Описания совпадают с prisma/seed.ts. */
export const CANONICAL_GAME_GIFTS: readonly CanonicalGiftSeed[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Уход для рук",
    shortDescription:
      "Мягкий уход для кожи рук, который помогает вернуть ощущение ухоженности, мягкости и внимания к себе.",
    probability: 50,
    priority: "main",
    cardStyle: "default",
    requiredPremiumLevel: 0,
    allowedGameDirections: [],
    allowedResultTypes: [],
    isActive: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Холодная плазма губ",
    shortDescription:
      "Деликатная процедура ухода за губами, направленная на улучшение качества кожи, увлажнённость и более гладкий рельеф.",
    probability: 25,
    priority: "standard",
    cardStyle: "accent",
    requiredPremiumLevel: 0,
    allowedGameDirections: ["faceCare", "faceMassage"],
    allowedResultTypes: [],
    isActive: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Лазерная биоревитализация",
    shortDescription:
      "Процедура для глубокого увлажнения и поддержки качества кожи.",
    probability: 18,
    priority: "rare",
    cardStyle: "accent",
    requiredPremiumLevel: 0,
    allowedGameDirections: ["faceCare", "recovery", "toneCare"],
    allowedResultTypes: [],
    isActive: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Формула сияния",
    shortDescription:
      "Комплексный уход для кожи, который помогает вернуть ощущение ухоженности, увлажнённости и более ровного внешнего вида кожи.",
    probability: 7,
    priority: "premium",
    cardStyle: "premium",
    requiredPremiumLevel: 2,
    allowedGameDirections: ["toneCare", "recovery"],
    allowedResultTypes: [],
    isActive: true,
  },
] as const;

export const TIER0_GIFT_PROBABILITIES: Readonly<Record<string, number>> = {
  "11111111-1111-4111-8111-111111111111": 50,
  "22222222-2222-4222-8222-222222222222": 25,
  "33333333-3333-4333-8333-333333333333": 18,
};

export const PREMIUM_GIFT_ID = "44444444-4444-4444-8444-444444444444" as const;

export const SHOWCASE_DISCOUNT_PROMOTION_ID =
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as const;

export const SHOWCASE_DISCOUNT_PROMOTION = {
  id: SHOWCASE_DISCOUNT_PROMOTION_ID,
  slug: "skidka-30-holodnaya-plazma",
  title: "Скидка -30% на холодную плазму",
  shortDescription:
    "Скидка 30% на первую процедуру холодной плазмы. В прайсе — полная стоимость.",
  description:
    "Скидка действует на первую процедуру холодной плазмы. В онлайн-записи и прайсе указана полная стоимость; акционную цену применим при визите в студию.",
  type: "DISCOUNT" as const,
  status: "ACTIVE" as const,
  isActive: true,
  showOnHomepage: true,
  startsAt: null,
  endsAt: null,
  discountValue: 30,
  discountUnit: "PERCENT" as const,
  discountDescription:
    "Скидка на первую процедуру холодной плазмы. В прайсе полная стоимость.",
  conditions:
    "Действует на первую процедуру холодной плазмы. Расчёт цены выполняет promo-engine; эта карточка только для витрины.",
  ctaText: "Записаться онлайн",
  ctaLink: "/booking",
  source: "MANUAL" as const,
  priority: 40,
} as const;
