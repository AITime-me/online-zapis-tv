/**
 * Production bootstrap CLI — канонические рабочие данные для чистой production DB.
 * Запускается внутри migrator (tsx + PrismaClient). Без @/-алиасов.
 *
 * Usage: --dry-run | --apply
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  assertCanonicalBootstrapIntegrity,
  BOOTSTRAP_EXPECTED_COUNTS,
  CANONICAL_CATEGORIES,
  CANONICAL_COLD_PLASMA_SERVICE_IDS,
  CANONICAL_GAME_GIFTS,
  CANONICAL_GIFT_IDS,
  CANONICAL_MASTERS,
  CANONICAL_SERVICES,
  PREMIUM_GIFT_ID,
  PROCEDURE_GIFT_CATALOG_SLUG,
  SHOWCASE_DISCOUNT_PROMOTION,
  SHOWCASE_DISCOUNT_PROMOTION_ID,
  type CanonicalCategorySeed,
  type CanonicalMasterSeed,
  type CanonicalServiceSeed,
} from "./production-bootstrap-canonical";

type CliFlags = { dryRun: boolean; apply: boolean };

type Action = "create" | "noop" | "conflict";

type EntityPlan<T> = {
  action: Action;
  canonical: T;
  reason?: string;
  existingId?: string;
};

type BootstrapPlan = {
  masters: EntityPlan<CanonicalMasterSeed>[];
  categories: EntityPlan<CanonicalCategorySeed>[];
  services: EntityPlan<CanonicalServiceSeed>[];
  masterServices: EntityPlan<CanonicalServiceSeed>[];
  gifts: EntityPlan<(typeof CANONICAL_GAME_GIFTS)[number]>[];
  promotion: EntityPlan<typeof SHOWCASE_DISCOUNT_PROMOTION>;
  promotionLinks: {
    action: Action;
    serviceId: string;
    reason?: string;
  }[];
  foundationErrors: string[];
  conflictCount: number;
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
        "Usage: production-bootstrap-data-cli.ts [--dry-run | --apply]",
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

function decEq(
  left: Prisma.Decimal | number | string | null | undefined,
  right: number | null,
): boolean {
  if (right === null) {
    return left === null || left === undefined;
  }
  if (left === null || left === undefined) {
    return false;
  }
  return new Prisma.Decimal(left).equals(new Prisma.Decimal(right));
}

function strEq(left: string | null | undefined, right: string | null): boolean {
  return (left ?? null) === right;
}

function jsonArrEq(left: unknown, right: readonly string[]): boolean {
  if (!Array.isArray(left)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function countActions(plans: { action: Action }[]): Record<Action, number> {
  return {
    create: plans.filter((p) => p.action === "create").length,
    noop: plans.filter((p) => p.action === "noop").length,
    conflict: plans.filter((p) => p.action === "conflict").length,
  };
}

async function assertFoundation(prisma: PrismaClient): Promise<string[]> {
  const errors: string[] = [];

  const settings = await prisma.studioSettings.findUnique({
    where: { id: "default" },
    select: { id: true },
  });
  if (!settings) {
    errors.push("foundation missing: StudioSettings id=default (run db:seed:production)");
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: "default" },
    select: { id: true, isActive: true },
  });
  if (!config) {
    errors.push("foundation missing: GameConfig id=default");
  } else if (config.isActive) {
    errors.push("GameConfig.default must be isActive=false before bootstrap");
  }

  const catalogs = await prisma.gameCatalog.findMany({
    where: { slug: PROCEDURE_GIFT_CATALOG_SLUG },
    select: {
      id: true,
      slug: true,
      status: true,
      isPrimaryPublic: true,
      legacyConfigId: true,
    },
  });
  if (catalogs.length === 0) {
    errors.push(`foundation missing: GameCatalog slug=${PROCEDURE_GIFT_CATALOG_SLUG}`);
  } else if (catalogs.length > 1) {
    errors.push(`ambiguous GameCatalog slug=${PROCEDURE_GIFT_CATALOG_SLUG}`);
  } else {
    const catalog = catalogs[0]!;
    if (catalog.status === "ACTIVE") {
      errors.push("GameCatalog.procedure-gift must remain non-ACTIVE (DISABLED)");
    }
    if (catalog.isPrimaryPublic) {
      errors.push("GameCatalog.procedure-gift must keep isPrimaryPublic=false");
    }
    if (catalog.legacyConfigId !== "default") {
      errors.push("GameCatalog.procedure-gift legacyConfigId must be default");
    }
  }

  return errors;
}

function masterMatches(
  existing: {
    internalName: string;
    publicName: string;
    slotMinutes: number;
    workStart: string;
    workEnd: string;
    breakAfterMinutes: number;
    usesDefaultWorkHours: boolean;
    sortOrder: number;
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
    userId: string | null;
  },
  canonical: CanonicalMasterSeed,
): string | null {
  if (existing.userId !== null) {
    return "userId must be null for bootstrap master";
  }
  const checks: Array<[string, boolean]> = [
    ["internalName", existing.internalName === canonical.internalName],
    ["publicName", existing.publicName === canonical.publicName],
    ["slotMinutes", existing.slotMinutes === canonical.slotMinutes],
    ["workStart", existing.workStart === canonical.workStart],
    ["workEnd", existing.workEnd === canonical.workEnd],
    ["breakAfterMinutes", existing.breakAfterMinutes === canonical.breakAfterMinutes],
    ["usesDefaultWorkHours", existing.usesDefaultWorkHours === canonical.usesDefaultWorkHours],
    ["sortOrder", existing.sortOrder === canonical.sortOrder],
    ["isActive", existing.isActive === canonical.isActive],
    ["isPublic", existing.isPublic === canonical.isPublic],
    ["isOnlineBookingEnabled", existing.isOnlineBookingEnabled === canonical.isOnlineBookingEnabled],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([field]) => field);
  return failed.length ? `field mismatch: ${failed.join(", ")}` : null;
}

function categoryMatches(
  existing: {
    name: string;
    sortOrder: number;
    isActive: boolean;
    isPublic: boolean;
  },
  canonical: CanonicalCategorySeed,
): string | null {
  const checks: Array<[string, boolean]> = [
    ["name", existing.name === canonical.name],
    ["sortOrder", existing.sortOrder === canonical.sortOrder],
    ["isActive", existing.isActive === canonical.isActive],
    ["isPublic", existing.isPublic === canonical.isPublic],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([field]) => field);
  return failed.length ? `field mismatch: ${failed.join(", ")}` : null;
}

function serviceMatches(
  existing: {
    categoryId: string;
    internalName: string;
    publicName: string;
    clientDescription: string | null;
    durationMinutes: number;
    breakAfterMinutes: number;
    priceFrom: Prisma.Decimal | null;
    priceTo: Prisma.Decimal | null;
    sortOrder: number;
    isActive: boolean;
    isPublic: boolean;
    isOnlineBookingEnabled: boolean;
  },
  canonical: CanonicalServiceSeed,
): string | null {
  const checks: Array<[string, boolean]> = [
    ["categoryId", existing.categoryId === canonical.categoryId],
    ["internalName", existing.internalName === canonical.internalName],
    ["publicName", existing.publicName === canonical.publicName],
    ["clientDescription", strEq(existing.clientDescription, canonical.clientDescription)],
    ["durationMinutes", existing.durationMinutes === canonical.durationMinutes],
    ["breakAfterMinutes", existing.breakAfterMinutes === canonical.breakAfterMinutes],
    ["priceFrom", decEq(existing.priceFrom, canonical.priceFrom)],
    ["priceTo", decEq(existing.priceTo, canonical.priceTo)],
    ["sortOrder", existing.sortOrder === canonical.sortOrder],
    ["isActive", existing.isActive === canonical.isActive],
    ["isPublic", existing.isPublic === canonical.isPublic],
    ["isOnlineBookingEnabled", existing.isOnlineBookingEnabled === canonical.isOnlineBookingEnabled],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([field]) => field);
  return failed.length ? `field mismatch: ${failed.join(", ")}` : null;
}

async function buildPlan(prisma: PrismaClient): Promise<BootstrapPlan> {
  assertCanonicalBootstrapIntegrity();
  const foundationErrors = await assertFoundation(prisma);

  const [
    mastersById,
    mastersAll,
    categoriesById,
    categoriesAll,
    servicesById,
    servicesAll,
    masterServices,
    giftsById,
    promotionById,
    promotionBySlug,
    promotionLinks,
    catalog,
  ] = await Promise.all([
    prisma.master.findMany({
      where: { id: { in: CANONICAL_MASTERS.map((m) => m.id) } },
    }),
    prisma.master.findMany({
      select: {
        id: true,
        internalName: true,
        publicName: true,
        slotMinutes: true,
        workStart: true,
        workEnd: true,
        breakAfterMinutes: true,
        usesDefaultWorkHours: true,
        sortOrder: true,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        userId: true,
      },
    }),
    prisma.serviceCategory.findMany({
      where: { id: { in: CANONICAL_CATEGORIES.map((c) => c.id) } },
    }),
    prisma.serviceCategory.findMany(),
    prisma.service.findMany({
      where: { id: { in: CANONICAL_SERVICES.map((s) => s.id) } },
    }),
    prisma.service.findMany({
      select: {
        id: true,
        categoryId: true,
        internalName: true,
        publicName: true,
        clientDescription: true,
        durationMinutes: true,
        breakAfterMinutes: true,
        priceFrom: true,
        priceTo: true,
        sortOrder: true,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        category: { select: { name: true } },
      },
    }),
    prisma.masterService.findMany({
      where: {
        OR: CANONICAL_SERVICES.map((s) => ({
          masterId: s.masterId,
          serviceId: s.id,
        })),
      },
    }),
    prisma.gameGift.findMany({
      where: { id: { in: [...CANONICAL_GIFT_IDS] } },
    }),
    prisma.promotion.findUnique({
      where: { id: SHOWCASE_DISCOUNT_PROMOTION_ID },
    }),
    prisma.promotion.findUnique({
      where: { slug: SHOWCASE_DISCOUNT_PROMOTION.slug },
    }),
    prisma.promotionService.findMany({
      where: { promotionId: SHOWCASE_DISCOUNT_PROMOTION_ID },
    }),
    prisma.gameCatalog.findFirst({
      where: { slug: PROCEDURE_GIFT_CATALOG_SLUG },
      select: { id: true },
    }),
  ]);

  const masterIdMap = new Map(mastersById.map((m) => [m.id, m]));
  const categoryIdMap = new Map(categoriesById.map((c) => [c.id, c]));
  const serviceIdMap = new Map(servicesById.map((s) => [s.id, s]));
  const linkKey = (masterId: string, serviceId: string) =>
    `${masterId}::${serviceId}`;
  const linkMap = new Map(
    masterServices.map((link) => [linkKey(link.masterId, link.serviceId), link]),
  );
  const giftMap = new Map(giftsById.map((g) => [g.id, g]));
  const promoLinkSet = new Set(promotionLinks.map((l) => l.serviceId));

  const masters: EntityPlan<CanonicalMasterSeed>[] = CANONICAL_MASTERS.map(
    (canonical) => {
      const byId = masterIdMap.get(canonical.id);
      const byName = mastersAll.find(
        (row) =>
          row.internalName === canonical.internalName ||
          row.publicName === canonical.publicName,
      );
      if (byId) {
        const mismatch = masterMatches(byId, canonical);
        if (mismatch) {
          return {
            action: "conflict" as const,
            canonical,
            reason: mismatch,
            existingId: byId.id,
          };
        }
        return { action: "noop" as const, canonical, existingId: byId.id };
      }
      if (byName && byName.id !== canonical.id) {
        return {
          action: "conflict" as const,
          canonical,
          reason: `name exists with different id ${byName.id}`,
          existingId: byName.id,
        };
      }
      return { action: "create" as const, canonical };
    },
  );

  const categories: EntityPlan<CanonicalCategorySeed>[] =
    CANONICAL_CATEGORIES.map((canonical) => {
      const byId = categoryIdMap.get(canonical.id);
      const byName = categoriesAll.find((row) => row.name === canonical.name);
      if (byId) {
        const mismatch = categoryMatches(byId, canonical);
        if (mismatch) {
          return {
            action: "conflict" as const,
            canonical,
            reason: mismatch,
            existingId: byId.id,
          };
        }
        return { action: "noop" as const, canonical, existingId: byId.id };
      }
      if (byName && byName.id !== canonical.id) {
        return {
          action: "conflict" as const,
          canonical,
          reason: `name exists with different id ${byName.id}`,
          existingId: byName.id,
        };
      }
      return { action: "create" as const, canonical };
    });

  const services: EntityPlan<CanonicalServiceSeed>[] = CANONICAL_SERVICES.map(
    (canonical) => {
      const byId = serviceIdMap.get(canonical.id);
      const byName = servicesAll.find(
        (row) =>
          row.category.name === canonical.categoryName &&
          (row.internalName === canonical.internalName ||
            row.publicName === canonical.publicName),
      );
      if (byId) {
        const mismatch = serviceMatches(byId, canonical);
        if (mismatch) {
          return {
            action: "conflict" as const,
            canonical,
            reason: mismatch,
            existingId: byId.id,
          };
        }
        return { action: "noop" as const, canonical, existingId: byId.id };
      }
      if (byName && byName.id !== canonical.id) {
        return {
          action: "conflict" as const,
          canonical,
          reason: `name exists with different id ${byName.id}`,
          existingId: byName.id,
        };
      }
      return { action: "create" as const, canonical };
    },
  );

  const masterServicePlans: EntityPlan<CanonicalServiceSeed>[] =
    CANONICAL_SERVICES.map((canonical) => {
      const existing = linkMap.get(linkKey(canonical.masterId, canonical.id));
      if (!existing) {
        return { action: "create" as const, canonical };
      }
      const ok =
        existing.isEnabled &&
        existing.isPublic &&
        existing.isOnlineBookingEnabled === canonical.isOnlineBookingEnabled &&
        existing.sortOrder === canonical.sortOrder &&
        existing.durationMinutesOverride === null &&
        existing.breakAfterMinutesOverride === null &&
        existing.priceOverride === null;
      if (!ok) {
        return {
          action: "conflict" as const,
          canonical,
          reason: "master_services fields differ from canon",
          existingId: `${canonical.masterId}/${canonical.id}`,
        };
      }
      return { action: "noop" as const, canonical };
    });

  const catalogId = catalog?.id ?? null;
  const gifts: EntityPlan<(typeof CANONICAL_GAME_GIFTS)[number]>[] =
    CANONICAL_GAME_GIFTS.map((canonical) => {
      const existing = giftMap.get(canonical.id);
      if (!existing) {
        return { action: "create" as const, canonical };
      }
      if (!catalogId) {
        return {
          action: "conflict" as const,
          canonical,
          reason: "procedure-gift catalog missing",
        };
      }
      const ok =
        existing.name === canonical.name &&
        existing.shortDescription === canonical.shortDescription &&
        existing.probability === canonical.probability &&
        existing.priority === canonical.priority &&
        existing.cardStyle === canonical.cardStyle &&
        existing.requiredPremiumLevel === canonical.requiredPremiumLevel &&
        existing.isActive === canonical.isActive &&
        existing.gameCatalogId === catalogId &&
        existing.activationMode === canonical.activationMode &&
        existing.minCourseSessions === canonical.minCourseSessions &&
        existing.activationConditionText === canonical.activationConditionText &&
        jsonArrEq(existing.allowedGameDirections, canonical.allowedGameDirections) &&
        jsonArrEq(existing.allowedResultTypes, canonical.allowedResultTypes);
      if (!ok) {
        return {
          action: "conflict" as const,
          canonical,
          reason: "gift fields differ from canon",
          existingId: existing.id,
        };
      }
      return { action: "noop" as const, canonical, existingId: existing.id };
    });

  let promotion: EntityPlan<typeof SHOWCASE_DISCOUNT_PROMOTION>;
  const promoCanon = SHOWCASE_DISCOUNT_PROMOTION;
  if (promotionById) {
    const ok =
      promotionById.slug === promoCanon.slug &&
      promotionById.title === promoCanon.title &&
      promotionById.shortDescription === promoCanon.shortDescription &&
      promotionById.description === promoCanon.description &&
      promotionById.type === promoCanon.type &&
      promotionById.status === promoCanon.status &&
      promotionById.isActive === promoCanon.isActive &&
      promotionById.showOnHomepage === promoCanon.showOnHomepage &&
      promotionById.startsAt === null &&
      promotionById.endsAt === null &&
      decEq(promotionById.discountValue, promoCanon.discountValue) &&
      promotionById.discountUnit === promoCanon.discountUnit &&
      promotionById.discountDescription === promoCanon.discountDescription &&
      promotionById.conditions === promoCanon.conditions &&
      promotionById.ctaText === promoCanon.ctaText &&
      promotionById.ctaLink === promoCanon.ctaLink &&
      promotionById.source === promoCanon.source &&
      promotionById.priority === promoCanon.priority;
    promotion = ok
      ? { action: "noop", canonical: promoCanon, existingId: promotionById.id }
      : {
          action: "conflict",
          canonical: promoCanon,
          reason: "promotion fields differ from canon",
          existingId: promotionById.id,
        };
  } else if (promotionBySlug && promotionBySlug.id !== promoCanon.id) {
    promotion = {
      action: "conflict",
      canonical: promoCanon,
      reason: `slug exists with different id ${promotionBySlug.id}`,
      existingId: promotionBySlug.id,
    };
  } else {
    promotion = { action: "create", canonical: promoCanon };
  }

  const promotionLinkPlans = CANONICAL_COLD_PLASMA_SERVICE_IDS.map((serviceId) => {
    if (promoLinkSet.has(serviceId)) {
      return { action: "noop" as const, serviceId };
    }
    return { action: "create" as const, serviceId };
  });

  for (const link of promotionLinks) {
    if (!CANONICAL_COLD_PLASMA_SERVICE_IDS.includes(link.serviceId)) {
      promotionLinkPlans.push({
        action: "conflict",
        serviceId: link.serviceId,
        reason: "unexpected promotion_services link outside cold plasma canon",
      });
    }
  }

  const conflictCount =
    countActions(masters).conflict +
    countActions(categories).conflict +
    countActions(services).conflict +
    countActions(masterServicePlans).conflict +
    countActions(gifts).conflict +
    (promotion.action === "conflict" ? 1 : 0) +
    countActions(promotionLinkPlans).conflict;

  return {
    masters,
    categories,
    services,
    masterServices: masterServicePlans,
    gifts,
    promotion,
    promotionLinks: promotionLinkPlans,
    foundationErrors,
    conflictCount,
  };
}

function printPlan(plan: BootstrapPlan): void {
  const sections: Array<[string, { action: Action }[]]> = [
    ["masters", plan.masters],
    ["categories", plan.categories],
    ["services", plan.services],
    ["master_services", plan.masterServices],
    ["gifts", plan.gifts],
    ["promotion_links", plan.promotionLinks],
  ];

  console.log("=== Production bootstrap data plan ===");
  console.log(
    `expected counts: masters=${BOOTSTRAP_EXPECTED_COUNTS.masters} categories=${BOOTSTRAP_EXPECTED_COUNTS.categories} services=${BOOTSTRAP_EXPECTED_COUNTS.services} master_services=${BOOTSTRAP_EXPECTED_COUNTS.masterServices} gifts=${BOOTSTRAP_EXPECTED_COUNTS.gifts} promotions=${BOOTSTRAP_EXPECTED_COUNTS.promotions} promotion_services=${BOOTSTRAP_EXPECTED_COUNTS.promotionServices}`,
  );

  for (const [label, rows] of sections) {
    const counts = countActions(rows);
    console.log(
      `${label}: create=${counts.create} noop=${counts.noop} conflict=${counts.conflict}`,
    );
  }
  console.log(
    `promotion: action=${plan.promotion.action}${plan.promotion.reason ? ` (${plan.promotion.reason})` : ""}`,
  );

  console.log("--- masters ---");
  for (const row of plan.masters) {
    console.log(
      `  [${row.action}] ${row.canonical.id} ${row.canonical.publicName}${row.reason ? ` :: ${row.reason}` : ""}`,
    );
  }
  console.log("--- categories ---");
  for (const row of plan.categories) {
    console.log(
      `  [${row.action}] ${row.canonical.id} ${row.canonical.name}${row.reason ? ` :: ${row.reason}` : ""}`,
    );
  }
  console.log("--- services (sample first 5 + conflicts) ---");
  const servicePreview = [
    ...plan.services.slice(0, 5),
    ...plan.services.filter((s) => s.action === "conflict"),
  ];
  const seen = new Set<string>();
  for (const row of servicePreview) {
    if (seen.has(row.canonical.id)) continue;
    seen.add(row.canonical.id);
    console.log(
      `  [${row.action}] #${row.canonical.importNum} ${row.canonical.id} ${row.canonical.publicName}${row.reason ? ` :: ${row.reason}` : ""}`,
    );
  }
  console.log(`  ... total services ${plan.services.length}`);

  console.log("--- gifts ---");
  for (const row of plan.gifts) {
    console.log(
      `  [${row.action}] ${row.canonical.id} ${row.canonical.name} p=${row.canonical.probability} tier=${row.canonical.requiredPremiumLevel}${row.reason ? ` :: ${row.reason}` : ""}`,
    );
  }
  console.log(
    `--- promotion ---\n  [${plan.promotion.action}] ${SHOWCASE_DISCOUNT_PROMOTION.id} ${SHOWCASE_DISCOUNT_PROMOTION.slug}`,
  );
  console.log(
    "notes: game stays DISABLED/isActive=false; discount engine untouched; OWNER/clients/appointments not created",
  );

  if (plan.foundationErrors.length) {
    console.log("--- foundation errors ---");
    for (const err of plan.foundationErrors) {
      console.log(`  ! ${err}`);
    }
  }
}

async function applyBootstrap(
  prisma: PrismaClient,
  plan: BootstrapPlan,
): Promise<void> {
  if (plan.foundationErrors.length) {
    throw new Error(`foundation pre-check failed:\n${plan.foundationErrors.join("\n")}`);
  }
  if (plan.conflictCount > 0) {
    throw new Error(
      `fail-fast: ${plan.conflictCount} conflict(s) — no writes performed`,
    );
  }

  const catalog = await prisma.gameCatalog.findFirst({
    where: { slug: PROCEDURE_GIFT_CATALOG_SLUG },
    select: { id: true, status: true, isPrimaryPublic: true },
  });
  if (!catalog) {
    throw new Error("procedure-gift catalog missing at apply");
  }

  await prisma.$transaction(async (tx) => {
    for (const row of plan.masters) {
      if (row.action !== "create") continue;
      const m = row.canonical;
      await tx.master.create({
        data: {
          id: m.id,
          internalName: m.internalName,
          publicName: m.publicName,
          slotMinutes: m.slotMinutes,
          workStart: m.workStart,
          workEnd: m.workEnd,
          breakAfterMinutes: m.breakAfterMinutes,
          usesDefaultWorkHours: m.usesDefaultWorkHours,
          sortOrder: m.sortOrder,
          isActive: m.isActive,
          isPublic: m.isPublic,
          isOnlineBookingEnabled: m.isOnlineBookingEnabled,
        },
      });
    }

    for (const row of plan.categories) {
      if (row.action !== "create") continue;
      const c = row.canonical;
      await tx.serviceCategory.create({
        data: {
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          isPublic: c.isPublic,
        },
      });
    }

    for (const row of plan.services) {
      if (row.action !== "create") continue;
      const s = row.canonical;
      await tx.service.create({
        data: {
          id: s.id,
          categoryId: s.categoryId,
          internalName: s.internalName,
          publicName: s.publicName,
          clientDescription: s.clientDescription,
          durationMinutes: s.durationMinutes,
          breakAfterMinutes: s.breakAfterMinutes,
          price: null,
          priceFrom: new Prisma.Decimal(s.priceFrom),
          priceTo:
            s.priceTo != null ? new Prisma.Decimal(s.priceTo) : null,
          sortOrder: s.sortOrder,
          isActive: s.isActive,
          isPublic: s.isPublic,
          isOnlineBookingEnabled: s.isOnlineBookingEnabled,
        },
      });
    }

    for (const row of plan.masterServices) {
      if (row.action !== "create") continue;
      const s = row.canonical;
      await tx.masterService.create({
        data: {
          masterId: s.masterId,
          serviceId: s.id,
          isEnabled: true,
          isPublic: true,
          isOnlineBookingEnabled: s.isOnlineBookingEnabled,
          sortOrder: s.sortOrder,
        },
      });
    }

    for (const row of plan.gifts) {
      if (row.action !== "create") continue;
      const g = row.canonical;
      await tx.gameGift.create({
        data: {
          id: g.id,
          name: g.name,
          shortDescription: g.shortDescription,
          probability: g.probability,
          priority: g.priority,
          cardStyle: g.cardStyle,
          requiredPremiumLevel: g.requiredPremiumLevel,
          allowedGameDirections: [...g.allowedGameDirections],
          allowedResultTypes: [...g.allowedResultTypes],
          activationMode: g.activationMode,
          minCourseSessions: g.minCourseSessions,
          activationConditionText: g.activationConditionText,
          isActive: g.isActive,
          gameCatalogId: catalog.id,
        },
      });
    }

    if (plan.promotion.action === "create") {
      const p = SHOWCASE_DISCOUNT_PROMOTION;
      await tx.promotion.create({
        data: {
          id: p.id,
          slug: p.slug,
          title: p.title,
          shortDescription: p.shortDescription,
          description: p.description,
          type: p.type,
          status: p.status,
          isActive: p.isActive,
          showOnHomepage: p.showOnHomepage,
          startsAt: null,
          endsAt: null,
          discountValue: new Prisma.Decimal(p.discountValue),
          discountUnit: p.discountUnit,
          discountDescription: p.discountDescription,
          conditions: p.conditions,
          ctaText: p.ctaText,
          ctaLink: p.ctaLink,
          source: p.source,
          priority: p.priority,
        },
      });
    }

    for (const link of plan.promotionLinks) {
      if (link.action !== "create") continue;
      await tx.promotionService.create({
        data: {
          promotionId: SHOWCASE_DISCOUNT_PROMOTION_ID,
          serviceId: link.serviceId,
        },
      });
    }
  });
}

async function runPostCheck(prisma: PrismaClient): Promise<void> {
  const errors: string[] = [];

  const masters = await prisma.master.findMany({
    where: { id: { in: CANONICAL_MASTERS.map((m) => m.id) } },
  });
  if (masters.length !== CANONICAL_MASTERS.length) {
    errors.push(
      `masters count ${masters.length} != ${CANONICAL_MASTERS.length}`,
    );
  }

  const categories = await prisma.serviceCategory.findMany({
    where: { id: { in: CANONICAL_CATEGORIES.map((c) => c.id) } },
  });
  if (categories.length !== CANONICAL_CATEGORIES.length) {
    errors.push(
      `categories count ${categories.length} != ${CANONICAL_CATEGORIES.length}`,
    );
  }

  const services = await prisma.service.findMany({
    where: { id: { in: CANONICAL_SERVICES.map((s) => s.id) } },
    include: { category: true },
  });
  if (services.length !== CANONICAL_SERVICES.length) {
    errors.push(
      `services count ${services.length} != ${CANONICAL_SERVICES.length}`,
    );
  }
  for (const canonical of CANONICAL_SERVICES) {
    const row = services.find((s) => s.id === canonical.id);
    if (!row) continue;
    if (row.categoryId !== canonical.categoryId) {
      errors.push(`service ${canonical.id} wrong categoryId`);
    }
    if (!row.isActive || !row.isPublic) {
      errors.push(`service ${canonical.id} must be active+public`);
    }
  }

  const links = await prisma.masterService.findMany({
    where: {
      serviceId: { in: CANONICAL_SERVICES.map((s) => s.id) },
    },
  });
  if (links.length !== CANONICAL_SERVICES.length) {
    errors.push(
      `master_services count ${links.length} != ${CANONICAL_SERVICES.length}`,
    );
  }
  const serviceIds = new Set(CANONICAL_SERVICES.map((s) => s.id));
  const masterIds = new Set(CANONICAL_MASTERS.map((m) => m.id));
  for (const link of links) {
    if (!serviceIds.has(link.serviceId) || !masterIds.has(link.masterId)) {
      errors.push(
        `orphan-ish binding ${link.masterId}/${link.serviceId} outside canon set`,
      );
    }
  }

  const catalog = await prisma.gameCatalog.findFirst({
    where: { slug: PROCEDURE_GIFT_CATALOG_SLUG },
  });
  const config = await prisma.gameConfig.findUnique({ where: { id: "default" } });
  if (!catalog || catalog.status === "ACTIVE" || catalog.isPrimaryPublic) {
    errors.push("game catalog must remain DISABLED and isPrimaryPublic=false");
  }
  if (!config || config.isActive) {
    errors.push("game_config.default must remain isActive=false");
  }

  const gifts = await prisma.gameGift.findMany({
    where: { id: { in: [...CANONICAL_GIFT_IDS] } },
  });
  if (gifts.length !== 4) {
    errors.push(`expected 4 canonical gifts, got ${gifts.length}`);
  }
  for (const gift of gifts) {
    if (gift.gameCatalogId !== catalog?.id) {
      errors.push(`gift ${gift.id} not bound to procedure-gift`);
    }
  }
  const formula = gifts.find((g) => g.id === PREMIUM_GIFT_ID);
  if (!formula || formula.requiredPremiumLevel !== 2) {
    errors.push("Формула сияния must keep requiredPremiumLevel=2");
  }

  const promo = await prisma.promotion.findUnique({
    where: { id: SHOWCASE_DISCOUNT_PROMOTION_ID },
  });
  if (
    !promo ||
    promo.status !== "ACTIVE" ||
    !promo.isActive ||
    !promo.showOnHomepage ||
    promo.startsAt !== null ||
    promo.endsAt !== null
  ) {
    errors.push("showcase promotion must be ACTIVE, open-ended, homepage");
  }

  const promoLinks = await prisma.promotionService.findMany({
    where: { promotionId: SHOWCASE_DISCOUNT_PROMOTION_ID },
  });
  if (promoLinks.length !== CANONICAL_COLD_PLASMA_SERVICE_IDS.length) {
    errors.push(
      `promotion_services count ${promoLinks.length} != ${CANONICAL_COLD_PLASMA_SERVICE_IDS.length}`,
    );
  }

  const clients = await prisma.client.count();
  const appointments = await prisma.appointment.count();
  const requests = await prisma.bookingRequest.count();
  const exampleUsers = await prisma.user.count({
    where: { email: { endsWith: "@example.local" } },
  });
  if (clients > 0) {
    // Bootstrap must not create clients; pre-existing unknown data is allowed,
    // but report zero created expectation via marker check only for @example.local.
  }
  if (exampleUsers > 0) {
    errors.push("bootstrap must not leave @example.local users");
  }
  void appointments;
  void requests;
  void clients;

  if (errors.length) {
    throw new Error(`post-check failed:\n${errors.join("\n")}`);
  }

  console.log("post-check: OK");
  console.log(
    `  masters=${masters.length} categories=${categories.length} services=${services.length} bindings=${links.length} gifts=${gifts.length} promoLinks=${promoLinks.length}`,
  );
  console.log("  game remains disabled; showcase ACTIVE open-ended");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const plan = await buildPlan(prisma);
    printPlan(plan);

    if (flags.dryRun) {
      if (plan.foundationErrors.length) {
        throw new Error(
          `dry-run foundation errors:\n${plan.foundationErrors.join("\n")}`,
        );
      }
      console.log("Dry-run complete — no writes.");
      return;
    }

    await applyBootstrap(prisma, plan);
    await runPostCheck(prisma);
    console.log("BOOTSTRAP_STATUS=success");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
