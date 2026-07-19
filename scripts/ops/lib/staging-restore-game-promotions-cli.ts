/**
 * CLI восстановления канонических подарков и витринной скидки на staging.
 * Запускается внутри migrator-контейнера (tsx + PrismaClient).
 *
 * Usage (через bash wrapper):
 *   --dry-run
 *   --apply
 */

import { PrismaClient } from "@prisma/client";
import {
  CANONICAL_GAME_GIFTS,
  PROCEDURE_GIFT_CATALOG_SLUG,
  PREMIUM_GIFT_ID,
  SHOWCASE_DISCOUNT_PROMOTION,
  SHOWCASE_DISCOUNT_PROMOTION_ID,
  runRestorePostCheck,
  type CatalogSnapshot,
} from "./staging-game-promotions-canonical";

type CliFlags = {
  dryRun: boolean;
  apply: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  let dryRun = false;
  let apply = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: staging-restore-game-promotions-cli.ts [--dry-run | --apply]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (dryRun && apply) {
    throw new Error("--dry-run and --apply are mutually exclusive");
  }
  if (!dryRun && !apply) {
    throw new Error("specify --dry-run or --apply");
  }

  return { dryRun, apply };
}

async function resolveProcedureGiftCatalog(
  prisma: PrismaClient,
): Promise<CatalogSnapshot> {
  const rows = await prisma.gameCatalog.findMany({
    where: { slug: PROCEDURE_GIFT_CATALOG_SLUG },
    select: {
      id: true,
      slug: true,
      status: true,
      legacyConfigId: true,
    },
  });

  if (rows.length === 0) {
    throw new Error(
      `fail-fast: game_catalog slug=${PROCEDURE_GIFT_CATALOG_SLUG} not found`,
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `fail-fast: ambiguous game_catalog slug=${PROCEDURE_GIFT_CATALOG_SLUG} (count=${rows.length})`,
    );
  }

  const catalog = rows[0]!;
  if (catalog.legacyConfigId !== "default") {
    throw new Error(
      `fail-fast: catalog legacy_config_id must be default, got ${catalog.legacyConfigId}`,
    );
  }

  return catalog;
}

async function loadPostCheckInput(prisma: PrismaClient, catalog: CatalogSnapshot) {
  const [config, gifts, promotions, linkCount] = await Promise.all([
    prisma.gameConfig.findUnique({
      where: { id: "default" },
      select: { id: true, isActive: true },
    }),
    prisma.gameGift.findMany({
      select: {
        id: true,
        name: true,
        probability: true,
        requiredPremiumLevel: true,
        isActive: true,
        gameCatalogId: true,
        activationMode: true,
        minCourseSessions: true,
        activationConditionText: true,
      },
    }),
    prisma.promotion.findMany({
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        isActive: true,
        showOnHomepage: true,
        startsAt: true,
        endsAt: true,
        ctaText: true,
        ctaLink: true,
        discountValue: true,
        type: true,
      },
    }),
    prisma.promotionService.count({
      where: { promotionId: SHOWCASE_DISCOUNT_PROMOTION_ID },
    }),
  ]);

  return {
    catalog,
    config,
    gifts,
    promotions,
    promotionServiceLinksForShowcase: linkCount,
  };
}

function printPlan(catalog: CatalogSnapshot): void {
  console.log("=== Staging restore game promotions plan ===");
  console.log(`catalog.id: ${catalog.id}`);
  console.log(`catalog.slug: ${catalog.slug}`);
  console.log(`catalog.status: ${catalog.status} (will not be activated)`);
  console.log(`gifts upsert: ${CANONICAL_GAME_GIFTS.length} canonical rows`);
  for (const gift of CANONICAL_GAME_GIFTS) {
    console.log(
      `  - ${gift.id} ${gift.name} p=${gift.probability} tier=${gift.requiredPremiumLevel}`,
    );
  }
  console.log(
    `promotion upsert: ${SHOWCASE_DISCOUNT_PROMOTION.id} ${SHOWCASE_DISCOUNT_PROMOTION.slug}`,
  );
  console.log(
    "note: PREMIUM gift remains in catalog; selection still blocked while PREMIUM_TIERS_ENABLED=false",
  );
  console.log("note: game stays disabled; no demo promotions; no game DB homepage card");
}

function assertGameRemainsDisabled(
  catalog: CatalogSnapshot,
  config: { id: string; isActive: boolean } | null,
): void {
  if (!config || config.id !== "default") {
    throw new Error("fail-fast: game_config.default is required");
  }
  if (config.isActive) {
    throw new Error(
      "fail-fast: refuse to restore while game_config.default.isActive=true (disable game first)",
    );
  }
  if (catalog.status === "ACTIVE") {
    throw new Error(
      "fail-fast: refuse to restore while game_catalog.procedure-gift is ACTIVE (disable game first)",
    );
  }
}

async function applyRestore(
  prisma: PrismaClient,
  catalog: CatalogSnapshot,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const gift of CANONICAL_GAME_GIFTS) {
      await tx.gameGift.upsert({
        where: { id: gift.id },
        create: {
          id: gift.id,
          name: gift.name,
          shortDescription: gift.shortDescription,
          probability: gift.probability,
          priority: gift.priority,
          cardStyle: gift.cardStyle,
          requiredPremiumLevel: gift.requiredPremiumLevel,
          allowedGameDirections: [...gift.allowedGameDirections],
          allowedResultTypes: [...gift.allowedResultTypes],
          activationMode: gift.activationMode,
          minCourseSessions: gift.minCourseSessions,
          activationConditionText: gift.activationConditionText,
          isActive: gift.isActive,
          gameCatalogId: catalog.id,
        },
        update: {
          name: gift.name,
          shortDescription: gift.shortDescription,
          probability: gift.probability,
          priority: gift.priority,
          cardStyle: gift.cardStyle,
          requiredPremiumLevel: gift.requiredPremiumLevel,
          allowedGameDirections: [...gift.allowedGameDirections],
          allowedResultTypes: [...gift.allowedResultTypes],
          activationMode: gift.activationMode,
          minCourseSessions: gift.minCourseSessions,
          activationConditionText: gift.activationConditionText,
          isActive: gift.isActive,
          gameCatalogId: catalog.id,
        },
      });
    }

    const promo = SHOWCASE_DISCOUNT_PROMOTION;
    await tx.promotion.upsert({
      where: { id: promo.id },
      create: {
        id: promo.id,
        slug: promo.slug,
        title: promo.title,
        shortDescription: promo.shortDescription,
        description: promo.description,
        type: promo.type,
        status: promo.status,
        isActive: promo.isActive,
        showOnHomepage: promo.showOnHomepage,
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        discountValue: promo.discountValue,
        discountUnit: promo.discountUnit,
        discountDescription: promo.discountDescription,
        conditions: promo.conditions,
        ctaText: promo.ctaText,
        ctaLink: promo.ctaLink,
        source: promo.source,
        priority: promo.priority,
      },
      update: {
        slug: promo.slug,
        title: promo.title,
        shortDescription: promo.shortDescription,
        description: promo.description,
        type: promo.type,
        status: promo.status,
        isActive: promo.isActive,
        showOnHomepage: promo.showOnHomepage,
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        discountValue: promo.discountValue,
        discountUnit: promo.discountUnit,
        discountDescription: promo.discountDescription,
        conditions: promo.conditions,
        ctaText: promo.ctaText,
        ctaLink: promo.ctaLink,
        source: promo.source,
        priority: promo.priority,
      },
    });

    await tx.promotionService.deleteMany({
      where: { promotionId: SHOWCASE_DISCOUNT_PROMOTION_ID },
    });
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const catalog = await resolveProcedureGiftCatalog(prisma);
    printPlan(catalog);

    const before = await loadPostCheckInput(prisma, catalog);
    assertGameRemainsDisabled(catalog, before.config);
    console.log("--- PRE-CHECK ---");
    console.log(`gifts total: ${before.gifts.length}`);
    console.log(
      `canonical gifts present: ${before.gifts.filter((g) => CANONICAL_GAME_GIFTS.some((c) => c.id === g.id)).length}`,
    );
    console.log(
      `showcase promotion present: ${before.promotions.some((p) => p.id === SHOWCASE_DISCOUNT_PROMOTION_ID)}`,
    );
    console.log(`game_config.isActive: ${before.config?.isActive ?? "missing"}`);
    console.log(`catalog.status: ${before.catalog.status}`);

    if (flags.dryRun) {
      console.log("Dry-run complete — no writes performed.");
      return;
    }

    await applyRestore(prisma, catalog);

    const refreshedCatalog = await resolveProcedureGiftCatalog(prisma);
    const after = await loadPostCheckInput(prisma, refreshedCatalog);
    const check = runRestorePostCheck(after);
    if (!check.ok) {
      console.error("POST-CHECK FAILED:");
      for (const error of check.errors) {
        console.error(`  - ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("--- POST-CHECK OK ---");
    console.log(`canonical gifts: ${CANONICAL_GAME_GIFTS.length}`);
    console.log(
      `premium gift ${PREMIUM_GIFT_ID} requiredPremiumLevel=2 (not selectable at tier-0)`,
    );
    console.log("game remains disabled");
    console.log("showcase discount card ready for homepage carousel");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "restore failed");
  process.exitCode = 1;
});
