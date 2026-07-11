/**
 * Production seed — минимальный технический фундамент для чистой БД.
 * Idempotent: не перезаписывает изменения владельца при повторном запуске.
 *
 * Запуск:
 *   npm run db:seed:production           — запись в БД
 *   npm run db:seed:production -- --dry-run — только план, без подключения к БД
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_BOT_SETTINGS } from "@/lib/bot-settings/defaults";
import { LEGAL_DOCUMENT_SEEDS } from "@/lib/legal-document/defaults";
import { DEFAULT_STUDIO_SETTINGS } from "@/lib/studio-settings/defaults";
import {
  getProductionSeedPlan,
  printProductionSeedDryRun,
  PRODUCTION_GAME_CATALOG_SLUG,
  PRODUCTION_GAME_CONFIG_ID,
} from "./lib/production-seed-plan";

const isDryRun = process.argv.includes("--dry-run");

const PRODUCTION_GAME_CONFIG_CREATE = {
  id: PRODUCTION_GAME_CONFIG_ID,
  isActive: false,
  title: "Поймай своё время",
  description:
    "Пройдите короткую игру — мы подберём направление ухода, подарок и готовый текст для отправки администратору.",
  resultHeaderText: "Ваш результат готов ✨",
  directionLabelText: "Ваше направление ухода:",
  giftLabelText: "Ваш подарок:",
  ctaButtonText: "Узнать свой подарок",
  ctaButtonLink: "/promo/procedure-gift",
  managerMessageHeader:
    "Здравствуйте!\n\nЯ прошла игру «Поймай своё время».\n\nМой результат:\n",
  managerMessageFooter: "Хочу узнать условия получения подарка и записаться.",
} as const;

async function seedStudioSettings(prisma: PrismaClient): Promise<"created" | "skipped"> {
  const existing = await prisma.studioSettings.findUnique({
    where: { id: DEFAULT_STUDIO_SETTINGS.id },
  });

  if (existing) {
    return "skipped";
  }

  await prisma.studioSettings.create({
    data: { ...DEFAULT_STUDIO_SETTINGS },
  });

  return "created";
}

async function seedBotSettings(prisma: PrismaClient): Promise<"created" | "skipped"> {
  const existing = await prisma.botSettings.findUnique({
    where: { id: DEFAULT_BOT_SETTINGS.id },
  });

  if (existing) {
    return "skipped";
  }

  await prisma.botSettings.create({
    data: {
      id: DEFAULT_BOT_SETTINGS.id,
      isEnabled: DEFAULT_BOT_SETTINGS.isEnabled,
      mode: DEFAULT_BOT_SETTINGS.mode,
      provider: DEFAULT_BOT_SETTINGS.provider,
      responseMode: DEFAULT_BOT_SETTINGS.responseMode,
      channels: DEFAULT_BOT_SETTINGS.channels,
      mainInstruction: DEFAULT_BOT_SETTINGS.mainInstruction,
      knowledgeBaseNote: DEFAULT_BOT_SETTINGS.knowledgeBaseNote,
      handoffRules: DEFAULT_BOT_SETTINGS.handoffRules,
      taggingRules: DEFAULT_BOT_SETTINGS.taggingRules,
      safetyRules: DEFAULT_BOT_SETTINGS.safetyRules,
      maxMessagesPerClient: DEFAULT_BOT_SETTINGS.maxMessagesPerClient,
      maxDailyMessages: DEFAULT_BOT_SETTINGS.maxDailyMessages,
      logRetentionDays: DEFAULT_BOT_SETTINGS.logRetentionDays,
      errorLogRetentionDays: DEFAULT_BOT_SETTINGS.errorLogRetentionDays,
      maxStoredBotEvents: DEFAULT_BOT_SETTINGS.maxStoredBotEvents,
    },
  });

  return "created";
}

async function seedLegalDocuments(
  prisma: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const document of LEGAL_DOCUMENT_SEEDS) {
    const existing = await prisma.legalDocument.findUnique({
      where: { slug: document.slug },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.legalDocument.create({
      data: {
        slug: document.slug,
        title: document.title,
        content: document.content,
        isPublished: document.isPublished,
      },
    });
    created += 1;
  }

  return { created, skipped };
}

async function seedGameConfig(prisma: PrismaClient): Promise<"created" | "skipped"> {
  const existing = await prisma.gameConfig.findUnique({
    where: { id: PRODUCTION_GAME_CONFIG_ID },
  });

  if (existing) {
    return "skipped";
  }

  await prisma.gameConfig.create({
    data: PRODUCTION_GAME_CONFIG_CREATE,
  });

  return "created";
}

async function seedGameCatalog(prisma: PrismaClient): Promise<"created" | "skipped"> {
  const existing = await prisma.gameCatalog.findFirst({
    where: { legacyConfigId: PRODUCTION_GAME_CONFIG_ID },
  });

  if (existing) {
    return "skipped";
  }

  const slugTaken = await prisma.gameCatalog.findUnique({
    where: { slug: PRODUCTION_GAME_CATALOG_SLUG },
  });

  if (slugTaken) {
    return "skipped";
  }

  await prisma.gameCatalog.create({
    data: {
      slug: PRODUCTION_GAME_CATALOG_SLUG,
      title: PRODUCTION_GAME_CONFIG_CREATE.title,
      type: "CATCH_TIME",
      status: "DISABLED",
      description: PRODUCTION_GAME_CONFIG_CREATE.description,
      legacyConfigId: PRODUCTION_GAME_CONFIG_ID,
    },
  });

  return "created";
}

async function main(): Promise<void> {
  if (isDryRun) {
    printProductionSeedDryRun();
    return;
  }

  const prisma = new PrismaClient();

  try {
    console.log("Production seed — запись в БД...\n");

    const studio = await seedStudioSettings(prisma);
    console.log(`StudioSettings: ${studio}`);

    const bot = await seedBotSettings(prisma);
    console.log(`BotSettings: ${bot}`);

    const legal = await seedLegalDocuments(prisma);
    console.log(`LegalDocument: created=${legal.created}, skipped=${legal.skipped}`);

    const gameConfig = await seedGameConfig(prisma);
    console.log(`GameConfig: ${gameConfig}`);

    const gameCatalog = await seedGameCatalog(prisma);
    console.log(`GameCatalog: ${gameCatalog}`);

    console.log("\nProduction seed завершён.");
    console.log("Проверьте реквизиты студии и юридические тексты после первого входа OWNER.");
    console.log(`Запланировано сущностей: ${getProductionSeedPlan().length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
