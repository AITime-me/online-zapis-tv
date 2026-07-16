/**
 * Канонические данные для staging restore подарков игры и витринной карточки скидки.
 * Без @/-алиасов — файл копируется в migrator-образ.
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

/** Демо-акции и старые кампании, которые restore не должен создавать. */
export const FORBIDDEN_PROMOTION_MARKERS = [
  { slug: "letnee-siyanie-kozhi", titleIncludes: "Летнее сияние" },
  { slug: "podbor-procedury-s-masterom", titleIncludes: "Подбор процедуры" },
  { slug: "formula-siyaniya-kampaniya", titleIncludes: "Формулой сияния" },
] as const;

export const DYNAMIC_GAME_HOME_PROMOTION_ID = "procedure-gift-game" as const;

export type GiftRowSnapshot = {
  id: string;
  name: string;
  probability: number;
  requiredPremiumLevel: number;
  isActive: boolean;
  gameCatalogId: string | null;
};

export type PromotionRowSnapshot = {
  id: string;
  slug: string;
  title: string;
  status: string;
  isActive: boolean;
  showOnHomepage: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  ctaText: string | null;
  ctaLink: string | null;
  discountValue: unknown;
  type: string;
};

export type CatalogSnapshot = {
  id: string;
  slug: string;
  status: string;
  legacyConfigId: string | null;
};

export type GameConfigSnapshot = {
  id: string;
  isActive: boolean;
};

export type RestorePostCheckInput = {
  catalog: CatalogSnapshot;
  config: GameConfigSnapshot | null;
  gifts: GiftRowSnapshot[];
  promotions: PromotionRowSnapshot[];
  promotionServiceLinksForShowcase: number;
};

export type RestorePostCheckResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function collectRestorePostCheckErrors(
  input: RestorePostCheckInput,
): string[] {
  const errors: string[] = [];

  if (input.catalog.slug !== PROCEDURE_GIFT_CATALOG_SLUG) {
    errors.push(`unexpected catalog slug: ${input.catalog.slug}`);
  }

  if (input.config?.id !== "default") {
    errors.push("game_config.default is missing");
  } else if (input.config.isActive) {
    errors.push("game_config.default must remain isActive=false");
  }

  if (input.catalog.status === "ACTIVE") {
    errors.push("game_catalog.procedure-gift must remain non-ACTIVE (disabled)");
  }

  const byId = new Map(input.gifts.map((gift) => [gift.id, gift]));
  for (const expected of CANONICAL_GAME_GIFTS) {
    const row = byId.get(expected.id);
    if (!row) {
      errors.push(`missing gift ${expected.id} (${expected.name})`);
      continue;
    }
    if (row.gameCatalogId !== input.catalog.id) {
      errors.push(`gift ${expected.id} is not bound to catalog ${input.catalog.id}`);
    }
    if (row.probability !== expected.probability) {
      errors.push(
        `gift ${expected.id} probability ${row.probability} != ${expected.probability}`,
      );
    }
    if (row.requiredPremiumLevel !== expected.requiredPremiumLevel) {
      errors.push(
        `gift ${expected.id} requiredPremiumLevel ${row.requiredPremiumLevel} != ${expected.requiredPremiumLevel}`,
      );
    }
    if (!row.isActive) {
      errors.push(`gift ${expected.id} must be isActive=true`);
    }
  }

  const canonicalSet = new Set<string>(CANONICAL_GIFT_IDS);
  const extraCanonical = input.gifts.filter(
    (gift) =>
      gift.gameCatalogId === input.catalog.id && canonicalSet.has(gift.id),
  );
  if (extraCanonical.length !== CANONICAL_GIFT_IDS.length) {
    errors.push(
      `expected exactly ${CANONICAL_GIFT_IDS.length} canonical gifts on catalog, got ${extraCanonical.length}`,
    );
  }

  const premium = byId.get(PREMIUM_GIFT_ID);
  if (premium && premium.requiredPremiumLevel !== 2) {
    errors.push("Формула сияния must keep requiredPremiumLevel=2");
  }

  const showcase = input.promotions.find(
    (row) => row.id === SHOWCASE_DISCOUNT_PROMOTION_ID,
  );
  if (!showcase) {
    errors.push("showcase discount promotion is missing");
  } else {
    if (showcase.slug !== SHOWCASE_DISCOUNT_PROMOTION.slug) {
      errors.push("showcase promotion slug mismatch");
    }
    if (showcase.status !== "ACTIVE" && showcase.status !== "active") {
      errors.push("showcase promotion must be ACTIVE");
    }
    if (!showcase.isActive || !showcase.showOnHomepage) {
      errors.push("showcase promotion must be active and showOnHomepage");
    }
    if (showcase.startsAt !== null || showcase.endsAt !== null) {
      errors.push("showcase promotion must be open-ended (null dates)");
    }
    if (showcase.ctaLink !== "/booking" || showcase.ctaText !== "Записаться онлайн") {
      errors.push("showcase promotion CTA must be Записаться онлайн → /booking");
    }
  }

  if (input.promotionServiceLinksForShowcase !== 0) {
    errors.push(
      "showcase promotion must not create promotion_services zone links",
    );
  }

  if (
    input.promotions.some((row) => row.id === DYNAMIC_GAME_HOME_PROMOTION_ID)
  ) {
    errors.push("DB must not contain a dedicated game homepage promotion row");
  }

  for (const marker of FORBIDDEN_PROMOTION_MARKERS) {
    const hit = input.promotions.find(
      (row) =>
        row.slug === marker.slug ||
        row.title.toLowerCase().includes(marker.titleIncludes.toLowerCase()),
    );
    if (hit) {
      errors.push(`forbidden demo/campaign promotion present: ${hit.slug}`);
    }
  }

  return errors;
}

export function runRestorePostCheck(
  input: RestorePostCheckInput,
): RestorePostCheckResult {
  const errors = collectRestorePostCheckErrors(input);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
