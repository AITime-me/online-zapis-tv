import "server-only";

import type { GameCatalogStatus, GameCatalogType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildGamePublicPath,
  buildGamePublicUrl,
  normalizeGameSlug,
} from "@/lib/games/catalog-contract";
import {
  canActivateGameCatalog,
  getGameCatalogActivationBlockReason,
  type GameCatalogDto,
  type GameCatalogStatusDto,
  type GameCatalogTypeDto,
  type GameCatalogWriteInput,
} from "@/types/game-catalog";

export class GameCatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameCatalogValidationError";
  }
}

export class GameCatalogNotFoundError extends Error {
  constructor(message = "Игра не найдена") {
    super(message);
    this.name = "GameCatalogNotFoundError";
  }
}

const LEGACY_CATCH_TIME_CONFIG_ID = "default";
const LEGACY_CATCH_TIME_SLUG = "procedure-gift";

function gameTypeFromDb(type: GameCatalogType): GameCatalogTypeDto {
  if (type === "WHEEL_OF_FORTUNE") {
    return "wheel_of_fortune";
  }
  return "catch_time";
}

function gameTypeToDb(type: GameCatalogTypeDto): GameCatalogType {
  if (type === "wheel_of_fortune") {
    return "WHEEL_OF_FORTUNE";
  }
  return "CATCH_TIME";
}

function gameStatusFromDb(status: GameCatalogStatus): GameCatalogStatusDto {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "DISABLED":
      return "disabled";
    case "ARCHIVED":
      return "archived";
    default:
      return "draft";
  }
}

function gameStatusToDb(status: GameCatalogStatusDto): GameCatalogStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "disabled":
      return "DISABLED";
    case "archived":
      return "ARCHIVED";
    default:
      return "DRAFT";
  }
}

function mapGameCatalog(
  row: Awaited<ReturnType<typeof prisma.gameCatalog.findMany>>[number],
  origin?: string | null,
): GameCatalogDto {
  const settings =
    row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: gameTypeFromDb(row.type),
    status: gameStatusFromDb(row.status),
    description: row.description,
    settings,
    externalUrl: row.externalUrl,
    legacyConfigId: row.legacyConfigId,
    publicPath: buildGamePublicPath(row.slug),
    publicUrl: buildGamePublicUrl(row.slug, origin),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.gameCatalog.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new GameCatalogValidationError("Slug уже используется другой игрой");
  }
}

export async function ensureLegacyCatchTimeGameCatalog(): Promise<GameCatalogDto> {
  const existing = await prisma.gameCatalog.findFirst({
    where: { legacyConfigId: LEGACY_CATCH_TIME_CONFIG_ID },
  });

  if (existing) {
    return mapGameCatalog(existing);
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: LEGACY_CATCH_TIME_CONFIG_ID },
  });

  const created = await prisma.gameCatalog.create({
    data: {
      slug: LEGACY_CATCH_TIME_SLUG,
      title: config?.title ?? "Поймай своё время",
      type: "CATCH_TIME",
      status: config?.isActive ? "ACTIVE" : "DISABLED",
      description: config?.description || null,
      legacyConfigId: LEGACY_CATCH_TIME_CONFIG_ID,
    },
  });

  return mapGameCatalog(created);
}

export async function listGameCatalog(origin?: string | null): Promise<GameCatalogDto[]> {
  await ensureLegacyCatchTimeGameCatalog();

  const rows = await prisma.gameCatalog.findMany({
    orderBy: [{ status: "asc" }, { title: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => mapGameCatalog(row, origin));
}

export async function getGameCatalogById(
  id: string,
  origin?: string | null,
): Promise<GameCatalogDto> {
  const row = await prisma.gameCatalog.findUnique({ where: { id } });
  if (!row) {
    throw new GameCatalogNotFoundError();
  }
  return mapGameCatalog(row, origin);
}

export async function getGameCatalogBySlug(
  slug: string,
  origin?: string | null,
): Promise<GameCatalogDto> {
  const row = await prisma.gameCatalog.findUnique({
    where: { slug: normalizeGameSlug(slug) },
  });
  if (!row) {
    throw new GameCatalogNotFoundError();
  }
  return mapGameCatalog(row, origin);
}

export async function createGameCatalog(
  input: GameCatalogWriteInput,
  origin?: string | null,
): Promise<GameCatalogDto> {
  const title = input.title?.trim();
  const slug = normalizeGameSlug(input.slug ?? "");
  const type = input.type ?? "wheel_of_fortune";
  const status = input.status ?? "draft";

  if (!title) {
    throw new GameCatalogValidationError("Название игры обязательно");
  }
  if (!slug) {
    throw new GameCatalogValidationError("Slug обязателен");
  }

  await assertUniqueSlug(slug);

  if (!canActivateGameCatalog(type, status)) {
    throw new GameCatalogValidationError(
      getGameCatalogActivationBlockReason(type) ??
        "Нельзя активировать игру этого типа",
    );
  }

  const created = await prisma.gameCatalog.create({
    data: {
      slug,
      title,
      type: gameTypeToDb(type),
      status: gameStatusToDb(status),
      description: input.description?.trim() || null,
      settings:
        input.settings !== undefined
          ? (input.settings as Prisma.InputJsonValue)
          : undefined,
      externalUrl: input.externalUrl?.trim() || null,
      legacyConfigId: null,
    },
  });

  return mapGameCatalog(created, origin);
}

export async function updateGameCatalog(
  id: string,
  input: GameCatalogWriteInput,
  origin?: string | null,
): Promise<GameCatalogDto> {
  const existing = await prisma.gameCatalog.findUnique({ where: { id } });
  if (!existing) {
    throw new GameCatalogNotFoundError();
  }

  const nextType = input.type ?? gameTypeFromDb(existing.type);
  const nextStatus = input.status ?? gameStatusFromDb(existing.status);

  if (!canActivateGameCatalog(nextType, nextStatus)) {
    throw new GameCatalogValidationError(
      getGameCatalogActivationBlockReason(nextType) ??
        "Нельзя активировать игру этого типа",
    );
  }

  const slug =
    input.slug !== undefined ? normalizeGameSlug(input.slug) : existing.slug;
  if (!slug) {
    throw new GameCatalogValidationError("Slug не может быть пустым");
  }

  await assertUniqueSlug(slug, id);

  const updated = await prisma.gameCatalog.update({
    where: { id },
    data: {
      slug: existing.legacyConfigId ? existing.slug : slug,
      title: input.title?.trim() ?? undefined,
      type: input.type ? gameTypeToDb(input.type) : undefined,
      status: input.status ? gameStatusToDb(input.status) : undefined,
      description:
        input.description !== undefined
          ? input.description?.trim() || null
          : undefined,
      settings:
        input.settings !== undefined
          ? (input.settings as Prisma.InputJsonValue)
          : undefined,
      externalUrl:
        input.externalUrl !== undefined
          ? input.externalUrl?.trim() || null
          : undefined,
    },
  });

  if (existing.legacyConfigId && input.status) {
    await prisma.gameConfig.update({
      where: { id: existing.legacyConfigId },
      data: { isActive: nextStatus === "active" },
    });
  }

  return mapGameCatalog(updated, origin);
}

export async function syncCatchTimeCatalogFromLegacyConfig(): Promise<void> {
  const catalog = await prisma.gameCatalog.findFirst({
    where: { legacyConfigId: LEGACY_CATCH_TIME_CONFIG_ID },
  });
  const config = await prisma.gameConfig.findUnique({
    where: { id: LEGACY_CATCH_TIME_CONFIG_ID },
  });

  if (!catalog || !config) {
    return;
  }

  await prisma.gameCatalog.update({
    where: { id: catalog.id },
    data: {
      title: config.title,
      description: config.description || null,
      status: config.isActive ? "ACTIVE" : "DISABLED",
    },
  });
}

export function isGameCatalogPubliclyAvailable(game: GameCatalogDto): boolean {
  if (game.status !== "active") {
    return false;
  }
  return canActivateGameCatalog(game.type, game.status);
}
