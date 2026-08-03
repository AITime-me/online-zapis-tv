import { Prisma, type GamePrizeType, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import {
  buildDefaultWheelCatalogSettings,
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  serializeDefaultPrizeRules,
  WHEEL_DEFAULT_SECTOR_COUNT,
} from "@/lib/game/wheel/default-prizes";
import { parsePrizeRules } from "@/lib/game/wheel/prize-rules-contract";
import { isGamePrizeType } from "@/lib/game/wheel/prize-types";
import {
  sumActiveWheelSectors,
  validateWheelSectorConfiguration,
  type WheelSectorGift,
} from "@/lib/game/wheel/sector-assignment";
import {
  defaultWheelSettings,
  resolveWheelSettingsFromCatalogSettings,
} from "@/lib/game/wheel/wheel-settings";
import type { WheelCatalogConfigDto } from "@/types/game-admin";

export function mapPrizeRulesJson(
  value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeSystemKey(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePrizeType(value: unknown): GamePrizeType | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!isGamePrizeType(value)) {
    throw new Error(
      "Тип приза должен быть PERCENT_DISCOUNT, GIFT_SERVICE или SERVICE_UPGRADE",
    );
  }
  return value;
}

export function normalizePrizeRulesInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  const parsed = parsePrizeRules(value);
  if (!parsed) {
    throw new Error("Некорректные правила приза (prizeRules)");
  }
  return parsed as unknown as Prisma.InputJsonValue;
}

export function giftsToSectorGifts(
  gifts: Array<{
    id: string;
    name: string;
    isActive: boolean;
    probability: number;
    systemKey: string | null;
    sortOrder: number;
  }>,
): WheelSectorGift[] {
  return gifts.map((gift) => ({
    id: gift.id,
    systemKey: gift.systemKey ?? gift.id,
    name: gift.name,
    isActive: gift.isActive,
    probability: gift.probability,
    sortOrder: gift.sortOrder,
  }));
}

export function buildWheelCatalogConfigDto(
  settingsRaw: unknown,
  gifts: WheelSectorGift[],
): WheelCatalogConfigDto {
  const parsed = resolveWheelSettingsFromCatalogSettings(settingsRaw);
  const settings =
    parsed.status === "invalid" ? defaultWheelSettings() : parsed.settings;
  const expected = settings.expectedSectorCount || WHEEL_DEFAULT_SECTOR_COUNT;
  const validation = validateWheelSectorConfiguration(gifts, expected);
  return {
    expectedSectorCount: expected,
    confirmWindowDays: settings.confirmWindowDays,
    procedureWindowDays: settings.procedureWindowDays,
    activeSectorSum: sumActiveWheelSectors(gifts),
    sectorConfigOk: validation.ok,
    sectorConfigError: validation.ok ? null : validation.error,
  };
}

/**
 * ACTIVE wheel requires a valid expanded 16-sector layout.
 * Throws Error with a public-safe message when invalid.
 */
export async function assertWheelCatalogReadyForActivation(
  gameCatalogId: string,
  settingsRaw?: unknown,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  const catalog = await db.gameCatalog.findUnique({
    where: { id: gameCatalogId },
    select: { id: true, type: true, settings: true },
  });
  if (!catalog || catalog.type !== "WHEEL_OF_FORTUNE") {
    throw new Error("Каталог колеса фортуны не найден");
  }

  const gifts = await db.gameGift.findMany({
    where: { gameCatalogId: catalog.id },
    select: {
      id: true,
      name: true,
      isActive: true,
      probability: true,
      systemKey: true,
      sortOrder: true,
    },
  });
  const settings = settingsRaw !== undefined ? settingsRaw : catalog.settings;
  const config = buildWheelCatalogConfigDto(settings, giftsToSectorGifts(gifts));
  if (!config.sectorConfigOk) {
    throw new Error(
      config.sectorConfigError || "Конфигурация колеса невалидна",
    );
  }
}

/**
 * Idempotently seed default permanent-makeup wheel prizes for a draft catalog.
 * Does not modify Catch-Time gifts or activate the game.
 */
export async function ensureDefaultWheelPrizes(
  gameCatalogId: string,
): Promise<{ created: number; skipped: number }> {
  const catalog = await defaultPrisma.gameCatalog.findUnique({
    where: { id: gameCatalogId },
    select: { id: true, type: true, settings: true, campaignKey: true },
  });
  if (!catalog || catalog.type !== "WHEEL_OF_FORTUNE") {
    throw new Error("Каталог колеса фортуны не найден");
  }

  if (catalog.settings == null) {
    await defaultPrisma.gameCatalog.update({
      where: { id: catalog.id },
      data: {
        settings: buildDefaultWheelCatalogSettings() as Prisma.InputJsonValue,
        campaignKey: catalog.campaignKey ?? "permanent-wheel",
        rulesVersion: "1",
      },
    });
  }

  let created = 0;
  let skipped = 0;

  for (const definition of DEFAULT_WHEEL_PRIZE_DEFINITIONS) {
    const existing = await defaultPrisma.gameGift.findFirst({
      where: {
        gameCatalogId: catalog.id,
        systemKey: definition.systemKey,
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await defaultPrisma.gameGift.create({
      data: {
        name: definition.name,
        shortDescription: definition.shortDescription,
        isActive: definition.isActive,
        probability: definition.sectorCount,
        priority:
          definition.systemKey === "permanent_discount_20" ? "jackpot" : "standard",
        cardStyle: "default",
        activationMode: "SINGLE_PAID_SERVICE",
        minCourseSessions: null,
        activationConditionText: definition.activationConditionText,
        systemKey: definition.systemKey,
        prizeType: definition.prizeType,
        prizeRules: serializeDefaultPrizeRules(
          definition,
        ) as unknown as Prisma.InputJsonValue,
        sortOrder: definition.sortOrder,
        gameCatalogId: catalog.id,
      },
    });
    created += 1;
  }

  return { created, skipped };
}
