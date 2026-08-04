import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  dedupeHomePromotionCards,
  isGameCatalogEligibleForHomepage,
  LEGACY_CATCH_TIME_HOME_PROMOTION_ID,
  mapGameCatalogToHomePromotion,
} from "../src/lib/promotions/home-game-catalog";
import type { GameCatalogDto } from "../src/types/game-catalog";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function baseWheelGame(
  overrides: Partial<GameCatalogDto> = {},
): GameCatalogDto {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "permanent-wheel",
    title: "Колесо фортуны",
    type: "wheel_of_fortune",
    status: "active",
    description: "Получите подарок",
    settings: null,
    externalUrl: null,
    legacyConfigId: null,
    publicPath: "/promo/permanent-wheel",
    publicUrl: "/promo/permanent-wheel",
    campaignKey: "permanent-wheel",
    rulesVersion: "1",
    isPrimaryPublic: false,
    showOnHomepage: true,
    publicPriority: 5,
    activeFrom: null,
    activeTo: null,
    serverReadiness: {
      settingsStatus: "valid",
      serverPolicy: "tier-0-only",
      premiumDisabledNotice: "test",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function assertEligibilityRules(): void {
  const activeVisible = baseWheelGame();
  assert.equal(isGameCatalogEligibleForHomepage(activeVisible), true);

  assert.equal(
    isGameCatalogEligibleForHomepage({
      ...activeVisible,
      showOnHomepage: false,
    }),
    false,
  );

  assert.equal(
    isGameCatalogEligibleForHomepage({
      ...activeVisible,
      status: "disabled",
    }),
    false,
  );

  assert.equal(
    isGameCatalogEligibleForHomepage({
      ...activeVisible,
      slug: "",
    }),
    false,
  );
}

function assertHomePromotionMapping(): void {
  const card = mapGameCatalogToHomePromotion(baseWheelGame());
  assert.equal(card.ctaHref, "/promo/permanent-wheel");
  assert.equal(card.title, "Колесо фортуны");
  assert.equal(card.description, "Получите подарок");
  assert.equal(card.kind, "game");
}

function assertCatchTimeRegression(): void {
  const home = read("src/services/HomePromotionsService.ts");
  assert.match(home, /LEGACY_CATCH_TIME_HOME_PROMOTION_ID/);
  assert.match(home, /procedure-gift-game|LEGACY_CATCH_TIME_HOME_PROMOTION_ID/);
  assert.match(home, /config\?\.isActive/);
  assert.match(home, /ensureLegacyCatchTimeGameCatalog/);
}

function assertCatalogIntegration(): void {
  const home = read("src/services/HomePromotionsService.ts");
  assert.match(home, /listHomepageGameCatalogs/);
  assert.match(home, /mapGameCatalogToHomePromotion/);
  assert.match(home, /dedupeHomePromotionCards/);

  const catalogService = read("src/services/GameCatalogService.ts");
  assert.match(catalogService, /showOnHomepage/);
  assert.match(catalogService, /listHomepageGameCatalogs/);
}

function assertHomePageCarouselScope(): void {
  const homePage = read("src/app/page.tsx");
  const bookingPage = read("src/app/booking/page.tsx");
  const homeComponent = read("src/components/home/home-page.tsx");

  assert.match(homePage, /getHomePromotions/);
  assert.match(homeComponent, /HomePromoCarousel/);
  assert.match(homeComponent, /Особенные предложения для Вас/);
  assert.doesNotMatch(bookingPage, /HomePromoCarousel|getHomePromotions/);
}

function assertNoDuplicateCards(): void {
  const catchTimeCard = {
    id: LEGACY_CATCH_TIME_HOME_PROMOTION_ID,
    kind: "game" as const,
    title: "Поймай своё время",
    description: "Старая игра",
    ctaLabel: "Играть",
    ctaHref: "/promo/procedure-gift",
    sortOrder: 2,
    isActive: true,
  };
  const wheelCard = mapGameCatalogToHomePromotion(
    baseWheelGame({ slug: "procedure-gift" }),
  );

  const deduped = dedupeHomePromotionCards([catchTimeCard, wheelCard, wheelCard]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.ctaHref, "/promo/procedure-gift");
}

assertEligibilityRules();
assertHomePromotionMapping();
assertCatchTimeRegression();
assertCatalogIntegration();
assertHomePageCarouselScope();
assertNoDuplicateCards();

console.log("home-promotions-service-check: OK");
