import "server-only";

import { PROMO_RULES } from "@/lib/promo/promo-engine";
import { getStudioNow } from "@/lib/datetime/date-layer";
import { BOT_ADDRESS_FIELD_GAPS } from "@/lib/bot-settings/campaign-engine";
import type {
  BotKnowledgeFoundationSnapshot,
  BotKnowledgeFoundationSummary,
  BotKnowledgePromoFact,
  BotKnowledgeSourceReport,
} from "@/lib/bot-knowledge/types";
import {
  getBookingCatalog,
  listBookableMasters,
} from "@/services/BookingService";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";
import { listHomepagePromotions } from "@/services/PromotionCrudService";
import { isPromotionEligibleForHomepageCarousel } from "@/lib/promotions/homepage-eligibility";
import {
  ensureLegacyCatchTimeGameCatalog,
  isGameCatalogPubliclyAvailable,
} from "@/services/GameCatalogService";
import { prisma } from "@/lib/db";

const DEFAULT_CONFIG_ID = "default";

/**
 * Read-only knowledge foundation for the external Bot Core control plane.
 * Uses existing public/booking layers only — no invented prices or slots.
 * Does not call AI providers or external APIs. No direct Bot Core DB contract.
 */
export async function buildBotKnowledgeFoundationSnapshot(): Promise<BotKnowledgeFoundationSnapshot> {
  const now = getStudioNow();
  const checkedAt = now.toISOString();

  const [catalog, masters, studio, homepagePromotions, gameCatalog, gameConfig] =
    await Promise.all([
      getBookingCatalog(),
      listBookableMasters(),
      getPublicStudioSettings(),
      listHomepagePromotions(),
      ensureLegacyCatchTimeGameCatalog(),
      prisma.gameConfig.findUnique({ where: { id: DEFAULT_CONFIG_ID } }),
    ]);

  const activeGifts = await prisma.gameGift.findMany({
    where: {
      isActive: true,
      OR: [{ gameCatalogId: gameCatalog.id }, { gameCatalogId: null }],
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  const categories = catalog.categories.map((category) => ({
    name: category.name,
    serviceCount: category.services.length,
    source: {
      source: "service_categories" as const,
      label: "service_categories (публичные активные)",
    },
  }));

  const services = catalog.categories.flatMap((category) =>
    category.services.map((service) => ({
      publicName: service.publicName,
      categoryName: category.name,
      description: service.clientDescription,
      durationMinutes: service.durationMinutes,
      priceLabel: service.priceLabel?.trim() || "Цена уточняется",
      source: {
        source: "services" as const,
        label: "services (публичные поля каталога)",
      },
    })),
  );

  const masterFacts = masters.map((master) => ({
    publicName: master.publicName,
    description: master.clientDescription,
    onlineBookingEnabled: master.isOnlineBookingEnabled,
    source: {
      source: "masters" as const,
      label: "masters (публичные активные)",
    },
  }));

  const promotions: BotKnowledgePromoFact[] = [];

  for (const rule of PROMO_RULES) {
    if (!rule.isActive) {
      continue;
    }
    promotions.push({
      title: rule.title,
      kind: "built_in_discount",
      summary: rule.description?.trim() || rule.badgeText?.trim() || rule.title,
      source: {
        source: "promo_rules",
        label: "PROMO_RULES / promo-engine (единственный расчёт скидки)",
      },
    });
  }

  for (const promotion of homepagePromotions) {
    if (!isPromotionEligibleForHomepageCarousel(promotion, now)) {
      continue;
    }
    promotions.push({
      title: promotion.title,
      kind: "homepage_card",
      summary:
        promotion.shortDescription?.trim() ||
        promotion.description?.trim() ||
        promotion.title,
      source: {
        source: "homepage_promotions",
        label: "Активные DB promotions (витрина)",
      },
    });
  }

  const gamePublic = isGameCatalogPubliclyAvailable(gameCatalog);
  const snapshotNote =
    "Фактический подарок и направление — только из GamePlay/GameSession snapshot. Старый пример «Уход для рук» устарел.";

  const game = gameConfig
    ? {
        title: gameConfig.title,
        publicPath: gameCatalog.publicPath,
        isPubliclyAvailable: gamePublic,
        activeGiftCount: activeGifts.length,
        giftTitles: activeGifts.map((gift) => gift.name),
        campaignKey: gameCatalog.campaignKey ?? null,
        rulesVersion: gameCatalog.rulesVersion ?? null,
        source: {
          source: "game_catalog" as const,
          label: "GameCatalog + GameConfig",
        },
        snapshotNote,
      }
    : null;

  const addressTrimmed = studio.address?.trim() || "";
  const missingAddressFields = BOT_ADDRESS_FIELD_GAPS.filter(
    (item) => !item.inStudioSettings,
  ).map((item) => item.field);

  const addressStatus =
    missingAddressFields.length > 0
      ? ("gap" as const)
      : addressTrimmed
        ? ("available" as const)
        : ("empty" as const);

  const address = {
    source: {
      source: "public_studio_settings" as const,
      label: "studio_settings.address",
    },
    addressPresent: addressTrimmed.length > 0,
    addressPreview: addressTrimmed ? addressTrimmed.slice(0, 80) : null,
    missingFields: missingAddressFields,
    status: addressStatus,
    note: "Адрес нельзя хардкодить в prompt. Доп. поля (карта, ориентир, этаж, вход, домофон, «переехали») требуют отдельного согласования — миграция сейчас не добавляется.",
  };

  const sources: BotKnowledgeSourceReport[] = [
    {
      id: "services",
      truthSource: "services",
      label: "Услуги",
      status: services.length > 0 ? "available" : "empty",
      publicEntityCount: services.length,
      lastCheckedAt: checkedAt,
      detail: "Публичные название, описание, цена, длительность",
    },
    {
      id: "service_categories",
      truthSource: "service_categories",
      label: "Категории",
      status: categories.length > 0 ? "available" : "empty",
      publicEntityCount: categories.length,
      lastCheckedAt: checkedAt,
      detail: "Активные публичные категории",
    },
    {
      id: "masters",
      truthSource: "masters",
      label: "Мастера",
      status: masterFacts.length > 0 ? "available" : "empty",
      publicEntityCount: masterFacts.length,
      lastCheckedAt: checkedAt,
      detail: "Публичные активные мастера",
    },
    {
      id: "master_services",
      truthSource: "master_services",
      label: "Услуги мастеров",
      status: "requires_api",
      publicEntityCount: null,
      lastCheckedAt: checkedAt,
      detail: "Для Bot Core нужен ограниченный API; прямой Prisma-доступ запрещён",
    },
    {
      id: "availability_service",
      truthSource: "BookingService availability",
      label: "Расписание / слоты",
      status: "requires_api",
      publicEntityCount: null,
      lastCheckedAt: checkedAt,
      detail:
        "Делегировано каноническому availability. Ranked slots + temporary hold API — gap",
    },
    {
      id: "promo_rules",
      truthSource: "PROMO_RULES",
      label: "Правила скидок",
      status: promotions.some((p) => p.kind === "built_in_discount")
        ? "available"
        : "empty",
      publicEntityCount: promotions.filter((p) => p.kind === "built_in_discount")
        .length,
      lastCheckedAt: checkedAt,
      detail: "Единственный расчёт скидки — promo-engine; второго движка нет",
    },
    {
      id: "homepage_promotions",
      truthSource: "promotions (DB)",
      label: "Витринные акции",
      status: promotions.some((p) => p.kind === "homepage_card")
        ? "available"
        : "empty",
      publicEntityCount: promotions.filter((p) => p.kind === "homepage_card")
        .length,
      lastCheckedAt: checkedAt,
      detail: "Карточки карусели; code words / bot scenarios — не реализованы",
    },
    {
      id: "game_catalog",
      truthSource: "game_catalog",
      label: "Игра (каталог)",
      status: game ? (gamePublic ? "available" : "not_configured") : "empty",
      publicEntityCount: game ? 1 : 0,
      lastCheckedAt: checkedAt,
      detail: "GameCatalog + публичность",
    },
    {
      id: "game_config",
      truthSource: "game_config",
      label: "Игра (конфиг)",
      status: gameConfig ? "available" : "empty",
      publicEntityCount: gameConfig ? 1 : 0,
      lastCheckedAt: checkedAt,
      detail: "Заголовки/CTA конфига",
    },
    {
      id: "game_play_snapshot",
      truthSource: "GamePlay / GameSession snapshot",
      label: "GAME FLOW результат",
      status: "requires_bot_core",
      publicEntityCount: null,
      lastCheckedAt: checkedAt,
      detail:
        "Фактический подарок/направление только из snapshot сессии; foundation не выбирает подарок",
    },
    {
      id: "public_studio_settings",
      truthSource: "studio_settings",
      label: "Публичные настройки / адрес",
      status: address.status,
      publicEntityCount: address.addressPresent ? 1 : 0,
      lastCheckedAt: checkedAt,
      detail: address.note,
    },
    {
      id: "legal_documents",
      truthSource: "legal documents / studio settings URLs",
      label: "Юридические документы",
      status: "available",
      publicEntityCount: null,
      lastCheckedAt: checkedAt,
      detail: "Согласие/оферта остаются в форме Booking; бот не собирает ПДн в чате",
    },
  ];

  return {
    status: "foundation",
    generatedAt: checkedAt,
    studio: {
      studioName: studio.studioName,
      workingHoursText: studio.workingHoursText,
      isOnlineBookingEnabled: studio.isOnlineBookingEnabled,
      isGameEnabled: studio.isGameEnabled,
      isPromotionsEnabled: studio.isPromotionsEnabled,
      source: {
        source: "public_studio_settings",
        label: "studio_settings (публичные поля)",
      },
    },
    address,
    categories,
    services,
    masters: masterFacts,
    promotions,
    game,
    availability: {
      source: {
        source: "availability_service",
        label: "Канонический booking availability",
      },
      status: "delegated",
      note: "Бот не считает слот свободным сам. Только BookingService.getAvailableTimeSlots / getAvailableDaysInMonth + будущий ranked API.",
      canonicalFunctions: [
        "BookingService.getAvailableTimeSlots",
        "BookingService.getAvailableDaysInMonth",
      ],
      temporaryHoldStatus: "gap",
      rankedSlotsStatus: "gap",
    },
    personalData: {
      note: "ПДн не в AI-чате. Полный дамп клиентов запрещён. Channel IDs/тексты — потенциальные ПДн.",
      allowFullClientDump: false,
      requireIdentifiedDialog: true,
      collectPhoneInChat: false,
    },
    sources,
    counts: {
      categories: categories.length,
      services: services.length,
      masters: masterFacts.length,
      promotions: promotions.length,
      gameGifts: activeGifts.length,
    },
  };
}

export async function buildBotKnowledgeFoundationSummary(): Promise<BotKnowledgeFoundationSummary> {
  const snapshot = await buildBotKnowledgeFoundationSnapshot();
  return {
    status: "foundation",
    generatedAt: snapshot.generatedAt,
    counts: snapshot.counts,
    availabilityDelegated: true,
    temporaryHoldGap: true,
    addressGap: snapshot.address.missingFields.length > 0,
    sources: snapshot.sources,
    notes: [
      "Control plane foundation: read-only из online-zapis-tv, без внешних AI-вызовов.",
      "Bot Core не получает прямой доступ к PostgreSQL.",
      snapshot.availability.note,
      snapshot.address.note,
      snapshot.personalData.note,
      snapshot.game?.snapshotNote ??
        "GAME FLOW snapshot semantics: подарок только из сессии, не из старых текстов KB.",
    ],
  };
}
