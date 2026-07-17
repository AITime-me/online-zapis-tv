/**
 * Security / regression checks for staging game gifts + showcase discount restore,
 * admin gift catalog binding, premium non-selection, and promo-engine isolation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertCreateGiftCatalogId,
  assertGiftBelongsToCatalog,
  GAME_GIFT_CATALOG_MISMATCH_ERROR,
  GAME_GIFT_CATALOG_REQUIRED_ERROR,
  GAME_GIFT_ORPHAN_FORBIDDEN_ERROR,
  rejectClientCatalogRebind,
} from "../src/lib/game/admin-gift-catalog-binding";
import { buildCatalogScopedGiftPool } from "../src/lib/game/session/catalog-gift-pool";
import { PREMIUM_TIERS_ENABLED } from "../src/lib/game/tier/server-tier-policy";
import { weightedGiftPick } from "../src/lib/game/weighted-gift-pick";
import { PROMO_RULES } from "../src/lib/promo/promo-engine";
import { isPromotionEligibleForHomepageCarousel } from "../src/lib/promotions/homepage-eligibility";
import {
  CANONICAL_GAME_GIFTS,
  PREMIUM_GIFT_ID,
  SHOWCASE_DISCOUNT_PROMOTION,
  SHOWCASE_DISCOUNT_PROMOTION_ID,
  TIER0_GIFT_PROBABILITIES,
  runRestorePostCheck,
} from "./ops/lib/staging-game-promotions-canonical";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertAdminGiftCatalogBinding(): void {
  const catalogA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const catalogB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  assert.equal(assertCreateGiftCatalogId(catalogA), catalogA);
  assert.throws(
    () => assertCreateGiftCatalogId(""),
    (error: Error) => error.message === GAME_GIFT_CATALOG_REQUIRED_ERROR,
  );
  assert.throws(
    () => assertCreateGiftCatalogId("not-a-uuid"),
    (error: Error) => error.message === GAME_GIFT_CATALOG_REQUIRED_ERROR,
  );

  assert.throws(
    () =>
      assertGiftBelongsToCatalog({
        giftCatalogId: null,
        expectedCatalogId: catalogA,
      }),
    (error: Error) => error.message === GAME_GIFT_ORPHAN_FORBIDDEN_ERROR,
  );
  assert.throws(
    () =>
      assertGiftBelongsToCatalog({
        giftCatalogId: catalogB,
        expectedCatalogId: catalogA,
      }),
    (error: Error) => error.message === GAME_GIFT_CATALOG_MISMATCH_ERROR,
  );
  assert.doesNotThrow(() =>
    assertGiftBelongsToCatalog({
      giftCatalogId: catalogA,
      expectedCatalogId: catalogA,
    }),
  );

  assert.throws(
    () => rejectClientCatalogRebind(catalogB, catalogA),
    (error: Error) => error.message === GAME_GIFT_CATALOG_MISMATCH_ERROR,
  );
  assert.doesNotThrow(() => rejectClientCatalogRebind(undefined, catalogA));
  assert.doesNotThrow(() => rejectClientCatalogRebind(catalogA, catalogA));

  const service = read("src/services/GameAdminService.ts");
  assert.match(service, /gameCatalogId:\s*catalogId/);
  assert.match(service, /createGameGift\(\s*gameCatalogId:\s*string/);
  assert.match(service, /updateGameGift\(\s*gameCatalogId:\s*string/);
  assert.match(service, /assertGiftBelongsToCatalog/);

  const legacyCreate = read("src/app/api/admin/game/gifts/route.ts");
  assert.match(legacyCreate, /GAME_GIFT_CATALOG_REQUIRED/);
  assert.doesNotMatch(stripComments(legacyCreate), /createGameGift\(/);

  const scopedCreate = read("src/app/api/admin/games/[id]/gifts/route.ts");
  assert.match(scopedCreate, /createGameGift\(gameCatalogId,\s*body\)/);
  assert.match(scopedCreate, /requireProtectedMutatingApi\(GAME_ADMIN_ROLES/);

  const panel = read("src/components/admin/game-panel.tsx");
  assert.match(panel, /\/api\/admin\/games\/\$\{encodeURIComponent\(gameCatalogId\)\}\/gifts/);
  assert.doesNotMatch(panel, /\/api\/admin\/game\/gifts"/);
}

function assertPremiumGiftNotSelected(): void {
  assert.equal(PREMIUM_TIERS_ENABLED, false);

  const catalogId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const gifts = CANONICAL_GAME_GIFTS.map((gift) => ({
    ...gift,
    gameCatalogId: catalogId,
  }));

  const pool = buildCatalogScopedGiftPool(gifts, catalogId, 0);
  assert.equal(pool.length, 3);
  assert.ok(!pool.some((gift) => gift.id === PREMIUM_GIFT_ID));
  assert.deepEqual(
    Object.fromEntries(pool.map((gift) => [gift.id, gift.probability])),
    TIER0_GIFT_PROBABILITIES,
  );

  for (let i = 0; i < 200; i += 1) {
    const picked = weightedGiftPick(pool);
    assert.ok(picked);
    assert.notEqual(picked.id, PREMIUM_GIFT_ID);
    assert.equal(picked.requiredPremiumLevel, 0);
  }

  const premiumOnly = buildCatalogScopedGiftPool(
    gifts.filter((gift) => gift.id === PREMIUM_GIFT_ID),
    catalogId,
    0,
  );
  assert.equal(premiumOnly.length, 0);
  assert.equal(weightedGiftPick(premiumOnly), null);
}

function assertPromoEngineIsolation(): void {
  const engine = read("src/lib/promo/promo-engine.ts");
  assert.match(engine, /cold-plasma-first-visit-30/);
  assert.doesNotMatch(engine, /prisma/);
  assert.doesNotMatch(engine, /listHomepagePromotions/);
  assert.doesNotMatch(engine, /PromotionCrudService/);
  assert.doesNotMatch(engine, /SHOWCASE_DISCOUNT|skidka-30-holodnaya-plazma|dddddddd/);

  const home = read("src/services/HomePromotionsService.ts");
  assert.match(home, /listHomepagePromotions/);
  assert.match(home, /procedure-gift-game/);
  assert.doesNotMatch(home, /promo-engine|applyPromo|PROMO_RULES|calculatePromo/);

  const rulesEngine = read("src/lib/promo/rules-engine.ts");
  assert.match(rulesEngine, /from \"@\/lib\/promo\/promo-engine\"/);
  assert.doesNotMatch(rulesEngine, /prisma\.promotion|listHomepagePromotions/);

  assert.ok(
    PROMO_RULES.some((rule) => rule.id === "cold-plasma-first-visit-30"),
  );
  assert.ok(
    !PROMO_RULES.some((rule) => rule.id === SHOWCASE_DISCOUNT_PROMOTION_ID),
  );

  const eligible = isPromotionEligibleForHomepageCarousel({
    id: SHOWCASE_DISCOUNT_PROMOTION.id,
    title: SHOWCASE_DISCOUNT_PROMOTION.title,
    slug: SHOWCASE_DISCOUNT_PROMOTION.slug,
    shortDescription: SHOWCASE_DISCOUNT_PROMOTION.shortDescription,
    description: SHOWCASE_DISCOUNT_PROMOTION.description,
    type: "discount",
    status: "active",
    isActive: true,
    showOnHomepage: true,
    startsAt: null,
    endsAt: null,
    giftTitle: null,
    giftDescription: null,
    discountValue: 30,
    discountUnit: "percent",
    discountDescription: SHOWCASE_DISCOUNT_PROMOTION.discountDescription,
    conditions: SHOWCASE_DISCOUNT_PROMOTION.conditions,
    ctaText: SHOWCASE_DISCOUNT_PROMOTION.ctaText,
    ctaLink: SHOWCASE_DISCOUNT_PROMOTION.ctaLink,
    imageUrl: null,
    priority: 40,
    source: "manual",
    serviceIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(eligible, true);
}

function assertRestorePostCheckAndOpsWiring(): void {
  const catalogId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const ok = runRestorePostCheck({
    catalog: {
      id: catalogId,
      slug: "procedure-gift",
      status: "DISABLED",
      legacyConfigId: "default",
    },
    config: { id: "default", isActive: false },
    gifts: CANONICAL_GAME_GIFTS.map((gift) => ({
      id: gift.id,
      name: gift.name,
      probability: gift.probability,
      requiredPremiumLevel: gift.requiredPremiumLevel,
      isActive: true,
      gameCatalogId: catalogId,
    })),
    promotions: [
      {
        id: SHOWCASE_DISCOUNT_PROMOTION.id,
        slug: SHOWCASE_DISCOUNT_PROMOTION.slug,
        title: SHOWCASE_DISCOUNT_PROMOTION.title,
        status: "ACTIVE",
        isActive: true,
        showOnHomepage: true,
        startsAt: null,
        endsAt: null,
        ctaText: SHOWCASE_DISCOUNT_PROMOTION.ctaText,
        ctaLink: SHOWCASE_DISCOUNT_PROMOTION.ctaLink,
        discountValue: 30,
        type: "DISCOUNT",
      },
    ],
    promotionServiceLinksForShowcase: 0,
  });
  assert.equal(ok.ok, true);

  const activeGameFail = runRestorePostCheck({
    catalog: {
      id: catalogId,
      slug: "procedure-gift",
      status: "DISABLED",
      legacyConfigId: "default",
    },
    config: { id: "default", isActive: true },
    gifts: [],
    promotions: [],
    promotionServiceLinksForShowcase: 0,
  });
  assert.equal(activeGameFail.ok, false);

  const shell = read("scripts/ops/staging-restore-game-promotions.sh");
  assert.match(shell, /ops_acquire_staging_ops_lock/);
  assert.match(shell, /ops_require_interactive_confirmation\s+"RESTORE GAME PROMOTIONS"/);
  assert.match(shell, /ops_create_postgres_backup\s+"pre-game-promotions"/);
  assert.match(shell, /APP_ENV=staging/);
  assert.match(shell, /--dry-run/);
  assert.doesNotMatch(shell, /prisma\s+db\s+seed|db:seed/);

  const deploy = stripComments(read("scripts/ops/staging-deploy.sh"));
  assert.doesNotMatch(deploy, /staging-restore-game-promotions/);

  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /staging-restore-game-promotions-cli\.ts/);
  assert.match(dockerfile, /game-promotions-canonical\.ts/);
  assert.match(dockerfile, /staging-game-promotions-canonical\.ts/);
  assert.match(dockerfile, /npx prisma generate/);

  assert.ok(fs.existsSync(path.join(ROOT, "docs/operations/staging-restore-game-promotions.md")));
}

assertAdminGiftCatalogBinding();
assertPremiumGiftNotSelected();
assertPromoEngineIsolation();
assertRestorePostCheckAndOpsWiring();

console.log("security-staging-game-promotions-restore-check: OK");
