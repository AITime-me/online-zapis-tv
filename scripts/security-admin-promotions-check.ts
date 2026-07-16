/**
 * Security / regression checks for admin promotions CRUD:
 * CTA URL policy, service ID validation, homepage eligibility,
 * promo-engine isolation, and built-in vs DB carousel separation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertHomepageCtaFields,
  assertSafePromotionCtaLink,
  isSafePromotionCtaLink,
  PROMOTION_CTA_LINK_HINT,
  PROMOTION_CTA_LINK_INVALID_ERROR,
  PROMOTION_CTA_LINK_SCHEME_ERROR,
} from "../src/lib/promotions/cta-link-policy";
import { isPromotionEligibleForHomepageCarousel } from "../src/lib/promotions/homepage-eligibility";
import {
  resolvePromotionServiceIdsForSync,
} from "../src/lib/promotions/promotion-services-sync";
import { PROMO_RULES } from "../src/lib/promo/promo-engine";
import { listPromotionRulesForAdmin } from "../src/services/PromotionAdminService";
import { SHOWCASE_DISCOUNT_PROMOTION_ID } from "./ops/lib/staging-game-promotions-canonical";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function basePromotionDto(
  overrides: Partial<Parameters<typeof isPromotionEligibleForHomepageCarousel>[0]> = {},
) {
  return {
    id: "p1",
    title: "Скидка -30% на холодную плазму",
    slug: "skidka-30-holodnaya-plazma",
    shortDescription: "Скидка на первую процедуру.",
    description: "Описание",
    type: "discount" as const,
    status: "active" as const,
    isActive: true,
    showOnHomepage: true,
    startsAt: null,
    endsAt: null,
    giftTitle: null,
    giftDescription: null,
    discountValue: 30,
    discountUnit: "percent" as const,
    discountDescription: null,
    conditions: null,
    ctaText: "Записаться онлайн",
    ctaLink: "/booking",
    imageUrl: null,
    priority: 40,
    source: "manual" as const,
    serviceIds: [] as string[],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function assertCtaPolicy(): void {
  assert.equal(assertSafePromotionCtaLink("/booking"), "/booking");
  assert.equal(assertSafePromotionCtaLink(" https://studio.example/path "), "https://studio.example/path");
  assert.equal(assertSafePromotionCtaLink(""), null);
  assert.equal(assertSafePromotionCtaLink(null), null);

  assert.equal(isSafePromotionCtaLink("javascript:alert(1)"), false);
  assert.equal(isSafePromotionCtaLink("data:text/html,hi"), false);
  assert.equal(isSafePromotionCtaLink("//evil.com"), false);
  assert.equal(isSafePromotionCtaLink("http://insecure.example"), false);
  assert.equal(isSafePromotionCtaLink("ftp://files"), false);

  assert.throws(
    () => assertSafePromotionCtaLink("javascript:alert(1)"),
    (error: Error) => error.message === PROMOTION_CTA_LINK_SCHEME_ERROR,
  );
  assert.throws(
    () => assertSafePromotionCtaLink("not a url"),
    (error: Error) => error.message === PROMOTION_CTA_LINK_INVALID_ERROR,
  );

  assert.doesNotThrow(() =>
    assertHomepageCtaFields({
      showOnHomepage: true,
      ctaText: "Записаться онлайн",
      ctaLink: "/booking",
    }),
  );
  assert.throws(
    () =>
      assertHomepageCtaFields({
        showOnHomepage: true,
        ctaText: "",
        ctaLink: "/booking",
      }),
  );
  assert.throws(
    () =>
      assertHomepageCtaFields({
        showOnHomepage: true,
        ctaText: "Записаться",
        ctaLink: "",
      }),
  );
  assert.doesNotThrow(() =>
    assertHomepageCtaFields({
      showOnHomepage: false,
      ctaText: "",
      ctaLink: "",
    }),
  );

  const panel = read("src/components/admin/promotions-panel.tsx");
  assert.match(panel, /PROMOTION_CTA_LINK_HINT/);
  assert.match(panel, /placeholder="\/booking"/);
  assert.equal(typeof PROMOTION_CTA_LINK_HINT, "string");
  assert.match(PROMOTION_CTA_LINK_HINT, /\/booking/);
}

function assertServiceIdValidation(): void {
  const activeA = {
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    internalName: "Услуга A",
  };
  const inactiveB = {
    id: "22222222-2222-4222-8222-222222222222",
    isActive: false,
    internalName: "Услуга B",
  };
  const testC = {
    id: "33333333-3333-4333-8333-333333333333",
    isActive: true,
    internalName: "Услуга (тест)",
  };

  assert.deepEqual(
    resolvePromotionServiceIdsForSync({
      requestedIds: [activeA.id, activeA.id],
      foundServices: [activeA],
      previouslyLinkedIds: [],
    }),
    [activeA.id],
  );

  assert.throws(() =>
    resolvePromotionServiceIdsForSync({
      requestedIds: [activeA.id, "99999999-9999-4999-8999-999999999999"],
      foundServices: [activeA],
      previouslyLinkedIds: [],
    }),
  );

  assert.throws(() =>
    resolvePromotionServiceIdsForSync({
      requestedIds: [inactiveB.id],
      foundServices: [inactiveB],
      previouslyLinkedIds: [],
    }),
  );

  assert.deepEqual(
    resolvePromotionServiceIdsForSync({
      requestedIds: [inactiveB.id],
      foundServices: [inactiveB],
      previouslyLinkedIds: [inactiveB.id],
    }),
    [inactiveB.id],
  );

  assert.throws(() =>
    resolvePromotionServiceIdsForSync({
      requestedIds: [testC.id],
      foundServices: [testC],
      previouslyLinkedIds: [],
    }),
  );

  const crud = stripComments(read("src/services/PromotionCrudService.ts"));
  assert.match(crud, /prisma\.\$transaction/);
  assert.match(crud, /syncPromotionServicesInTx/);
  assert.match(crud, /validateNewPromotionServiceIds/);
  assert.match(crud, /assertSafePromotionCtaLink|resolveCtaLinkForWrite/);
  assert.match(crud, /assertHomepageRequirements/);
  assert.match(crud, /publicName/);
  assert.doesNotMatch(crud, /internalName:\s*true[\s\S]*listPromotionServiceOptions\(\)/);
}

function assertHomepageEligibility(): void {
  assert.equal(isPromotionEligibleForHomepageCarousel(basePromotionDto()), true);

  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({ status: "draft" }),
    ),
    false,
  );
  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({ isActive: false }),
    ),
    false,
  );
  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({ showOnHomepage: false }),
    ),
    false,
  );
  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ),
    false,
  );
  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({
        endsAt: new Date(Date.now() - 86400000).toISOString(),
      }),
    ),
    false,
  );
  assert.equal(
    isPromotionEligibleForHomepageCarousel(
      basePromotionDto({ ctaText: "", ctaLink: "/booking" }),
    ),
    false,
  );
}

function assertBuiltInVsDbSeparation(): void {
  const rules = listPromotionRulesForAdmin();
  assert.ok(rules.some((rule) => rule.id === "cold-plasma-first-visit-30"));
  assert.ok(!rules.some((rule) => rule.id === SHOWCASE_DISCOUNT_PROMOTION_ID));
  assert.ok(
    rules.every(
      (rule) => rule.source === "promo-engine" || rule.source === "gift-engine",
    ),
  );
  assert.ok(!rules.some((rule) => rule.id.startsWith("planned-")));
  assert.ok(!rules.some((rule) => /правило в разработке/i.test(rule.clientText)));
  assert.ok(
    !rules.some((rule) =>
      /Подарок:\s*уход для рук|Подарок:\s*лазерная биоревитализация/i.test(
        rule.name,
      ),
    ),
  );

  assert.ok(PROMO_RULES.some((rule) => rule.id === "cold-plasma-first-visit-30"));
  assert.ok(!PROMO_RULES.some((rule) => rule.id === SHOWCASE_DISCOUNT_PROMOTION_ID));

  const adminService = read("src/services/PromotionAdminService.ts");
  assert.doesNotMatch(adminService, /PLANNED_GIFT_RULES/);
  assert.doesNotMatch(adminService, /PlannedGiftRule/);
  assert.doesNotMatch(adminService, /mapPlannedGiftRule/);
  assert.doesNotMatch(adminService, /plannedGifts/);
  assert.doesNotMatch(adminService, /source:\s*"planned"/);
  assert.doesNotMatch(adminService, /правило в разработке/);

  const table = read("src/components/admin/promotions-table.tsx");
  assert.doesNotMatch(table, /Запланировано/);
  assert.doesNotMatch(table, /source === "planned"/);
  assert.doesNotMatch(table, /Заготовка/);

  const engine = read("src/lib/promo/promo-engine.ts");
  assert.doesNotMatch(engine, /prisma|listHomepagePromotions|PromotionCrud/);

  const giftEngine = read("src/lib/promo/gift-engine.ts");
  assert.match(giftEngine, /export const GIFT_RULES:\s*GiftRule\[\]\s*=\s*\[\]/);

  // Empty GIFT_RULES must not break the admin list (promo rules still present).
  assert.ok(rules.length >= 1);
  assert.equal(
    rules.filter((rule) => rule.source === "gift-engine").length,
    0,
  );

  const page = read("src/app/admin/promotions/page.tsx");
  assert.match(page, /listPromotionRulesForAdmin/);
  assert.match(page, /builtInRules/);

  const panel = read("src/components/admin/promotions-panel.tsx");
  assert.match(panel, /Встроенные правила расчёта/);
  assert.match(panel, /Карточки акций для карусели/);
  assert.match(panel, /не заменяются карточками карусели|не влияет на расчёт скидки/);

  const schema = read("prisma/schema.prisma");
  assert.match(
    schema,
    /model PromotionService[\s\S]*promotion\s+Promotion[\s\S]*onDelete:\s*Cascade/,
  );
  assert.match(
    schema,
    /model PromotionService[\s\S]*service\s+Service[\s\S]*onDelete:\s*Cascade/,
  );
}

function assertRoleAccessWiring(): void {
  const apiAccess = read("src/lib/auth/api-access.ts");
  assert.match(apiAccess, /PROMOTIONS_ADMIN_ROLES:\s*UserRole\[\]\s*=\s*OWNER_ROLES/);

  const route = read("src/app/api/admin/promotions/route.ts");
  assert.match(route, /requireProtectedMutatingApi\(PROMOTIONS_ADMIN_ROLES/);
  assert.match(route, /requireApiRoles\(PROMOTIONS_ADMIN_ROLES/);

  const idRoute = read("src/app/api/admin/promotions/[id]/route.ts");
  assert.match(idRoute, /requireProtectedMutatingApi\(PROMOTIONS_ADMIN_ROLES/);

  const perms = read("src/lib/auth/permissions.ts");
  assert.match(perms, /\/admin\/promotions/);
  assert.match(perms, /canManagePromotionsAdmin/);
}

assertCtaPolicy();
assertServiceIdValidation();
assertHomepageEligibility();
assertBuiltInVsDbSeparation();
assertRoleAccessWiring();

console.log("security-admin-promotions-check: OK");
