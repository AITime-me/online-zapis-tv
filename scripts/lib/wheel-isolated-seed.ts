import type { PrismaClient } from "@prisma/client";
import { LegalDocumentVersionStatus } from "@prisma/client";
import { hashLegalDocumentContent } from "../../src/lib/legal-document/content-hash";
import {
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
} from "../../src/lib/legal-document/defaults";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  buildDefaultWheelCatalogSettings,
  serializeDefaultPrizeRules,
} from "../../src/lib/game/wheel/default-prizes";

export const WHEEL_E2E_SLUGS = {
  active: "e2e-wheel-active",
  draft: "e2e-wheel-draft",
  invalid: "e2e-wheel-invalid",
} as const;

export type WheelE2eSlugs = typeof WHEEL_E2E_SLUGS;

export const CATALOG_IDS = {
  active: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  draft: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  invalid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;

/** Distinct gift id namespace per catalog — shared UUIDs would move gifts between catalogs on upsert. */
export const CATALOG_GIFT_ID_PREFIX: Record<keyof typeof CATALOG_IDS, string> = {
  active: "00000000-0000-4000-8000",
  draft: "00000000-0000-4000-8001",
  invalid: "00000000-0000-4000-8002",
};

function catalogKeyFromId(catalogId: string): keyof typeof CATALOG_IDS | null {
  if (catalogId === CATALOG_IDS.active) {
    return "active";
  }
  if (catalogId === CATALOG_IDS.draft) {
    return "draft";
  }
  if (catalogId === CATALOG_IDS.invalid) {
    return "invalid";
  }
  return null;
}

export function wheelGiftId(catalogId: string, index: number): string {
  const catalogKey = catalogKeyFromId(catalogId);
  if (!catalogKey) {
    throw new Error(`unknown wheel E2E catalog id: ${catalogId}`);
  }
  const prefix = CATALOG_GIFT_ID_PREFIX[catalogKey];
  return `${prefix}-${String(index + 1).padStart(12, "0")}`;
}

export async function publishRequiredLegalDocuments(
  prisma: PrismaClient,
): Promise<void> {
  for (const document of LEGAL_DOCUMENT_SEED_METADATA) {
    if (!REQUIRED_PUBLISHED_LEGAL_SLUGS.includes(document.slug as never)) {
      continue;
    }
    const created = await prisma.legalDocument.upsert({
      where: { slug: document.slug },
      update: {},
      create: {
        slug: document.slug,
        title: document.title,
        publicPath: document.publicPath,
        content: "",
        isPublished: false,
      },
    });
    const latest = await prisma.legalDocumentVersion.findFirst({
      where: { documentId: created.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    const content = `Published content for ${document.slug}`;
    const version = await prisma.legalDocumentVersion.create({
      data: {
        documentId: created.id,
        versionNumber: nextVersionNumber,
        title: document.title,
        content,
        contentHash: hashLegalDocumentContent(content),
        status: LegalDocumentVersionStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    await prisma.legalDocument.update({
      where: { id: created.id },
      data: {
        currentPublishedVersionId: version.id,
        isPublished: true,
        content: version.content,
      },
    });
  }
}

async function upsertWheelGifts(
  prisma: PrismaClient,
  catalogId: string,
  options?: { onlyFirstGift?: boolean; deactivateAll?: boolean },
): Promise<void> {
  for (const [index, definition] of DEFAULT_WHEEL_PRIZE_DEFINITIONS.entries()) {
    if (options?.onlyFirstGift && index > 0) {
      continue;
    }
    const id = wheelGiftId(catalogId, index);
    const isActive = options?.deactivateAll ? false : definition.isActive;
    await prisma.gameGift.upsert({
      where: { id },
      update: {
        gameCatalogId: catalogId,
        name: definition.name,
        isActive,
        probability: definition.sectorCount,
        systemKey: definition.systemKey,
        sortOrder: definition.sortOrder,
        prizeType: definition.prizeType,
        prizeRules: serializeDefaultPrizeRules(definition) as object,
      },
      create: {
        id,
        gameCatalogId: catalogId,
        name: definition.name,
        shortDescription: definition.shortDescription,
        probability: definition.sectorCount,
        systemKey: definition.systemKey,
        sortOrder: definition.sortOrder,
        isActive,
        prizeType: definition.prizeType,
        prizeRules: serializeDefaultPrizeRules(definition) as object,
        activationMode: "SINGLE_PAID_SERVICE",
        activationConditionText: definition.activationConditionText,
        priority:
          definition.systemKey === "permanent_discount_20" ? "jackpot" : "standard",
        cardStyle: "default",
      },
    });
  }
}

async function upsertWheelCatalog(
  prisma: PrismaClient,
  input: {
    id: string;
    slug: string;
    status: "ACTIVE" | "DRAFT" | "DISABLED";
    title: string;
  },
): Promise<void> {
  await prisma.gameCatalog.upsert({
    where: { id: input.id },
    update: {
      slug: input.slug,
      title: input.title,
      type: "WHEEL_OF_FORTUNE",
      status: input.status,
      settings: buildDefaultWheelCatalogSettings() as object,
      campaignKey: "permanent-wheel",
    },
    create: {
      id: input.id,
      slug: input.slug,
      title: input.title,
      type: "WHEEL_OF_FORTUNE",
      status: input.status,
      settings: buildDefaultWheelCatalogSettings() as object,
      campaignKey: "permanent-wheel",
      rulesVersion: "1",
    },
  });
}

async function seedProcedureGiftBaseline(prisma: PrismaClient): Promise<void> {
  await prisma.gameConfig.upsert({
    where: { id: "default" },
    update: { isActive: true },
    create: {
      id: "default",
      isActive: true,
      title: "Поймай своё время",
      description: "E2E isolated catch-time baseline",
      resultHeaderText: "Ваш результат готов",
      directionLabelText: "Направление:",
      giftLabelText: "Подарок:",
      ctaButtonText: "Узнать подарок",
      ctaButtonLink: "/promo/procedure-gift",
      managerMessageHeader: "Здравствуйте!",
      managerMessageFooter: "Хочу записаться.",
    },
  });
}

/**
 * Seeds isolated wheel E2E catalogs and baseline catch-time page data.
 * Data exists only in the ephemeral database passed to this function.
 */
export async function seedWheelIsolatedE2eData(
  prisma: PrismaClient,
): Promise<WheelE2eSlugs> {
  await prisma.studioSettings.upsert({
    where: { id: "default" },
    update: { isGameEnabled: true },
    create: { id: "default", isGameEnabled: true },
  });

  await publishRequiredLegalDocuments(prisma);
  await seedProcedureGiftBaseline(prisma);

  await upsertWheelCatalog(prisma, {
    id: CATALOG_IDS.active,
    slug: WHEEL_E2E_SLUGS.active,
    status: "ACTIVE",
    title: "E2E Wheel Active",
  });
  await upsertWheelGifts(prisma, CATALOG_IDS.active);

  await upsertWheelCatalog(prisma, {
    id: CATALOG_IDS.draft,
    slug: WHEEL_E2E_SLUGS.draft,
    status: "DRAFT",
    title: "E2E Wheel Draft",
  });
  await upsertWheelGifts(prisma, CATALOG_IDS.draft);

  await upsertWheelCatalog(prisma, {
    id: CATALOG_IDS.invalid,
    slug: WHEEL_E2E_SLUGS.invalid,
    status: "ACTIVE",
    title: "E2E Wheel Invalid",
  });
  // Only one sector — invalid for 16-sector wheel gate.
  await upsertWheelGifts(prisma, CATALOG_IDS.invalid, { onlyFirstGift: true });

  return WHEEL_E2E_SLUGS;
}
