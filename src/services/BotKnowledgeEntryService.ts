import "server-only";

import {
  BotKnowledgeCategory,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BOT_KNOWLEDGE_CATEGORIES,
  type BotKnowledgeCategoryId,
} from "@/lib/bot-knowledge/publication-contract";
import { assertNoObviousPriceCopy } from "@/lib/bot-knowledge/publication-payload";
import type {
  BotKnowledgeEntryCreateInput,
  BotKnowledgeEntryDto,
  BotKnowledgeEntryWriteInput,
  BotKnowledgeServiceOptionDto,
} from "@/types/bot-knowledge";

export class BotKnowledgeEntryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT" = "VALIDATION",
  ) {
    super(message);
    this.name = "BotKnowledgeEntryError";
  }
}

const STABLE_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_STABLE_KEY = 120;
const MAX_TITLE = 200;
const MAX_CONTENT = 20_000;
const MAX_TAG = 64;
const MAX_TAGS = 20;

const entrySelect = {
  id: true,
  stableKey: true,
  category: true,
  title: true,
  content: true,
  tags: true,
  serviceId: true,
  isEnabled: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
  updatedByUserId: true,
  service: {
    select: {
      publicName: true,
    },
  },
  updatedByUser: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BotKnowledgeEntrySelect;

type EntryRow = Prisma.BotKnowledgeEntryGetPayload<{ select: typeof entrySelect }>;

const ALLOWED_CATEGORIES = new Set<string>(BOT_KNOWLEDGE_CATEGORIES);

function mapEntry(row: EntryRow): BotKnowledgeEntryDto {
  return {
    id: row.id,
    stableKey: row.stableKey,
    category: row.category as BotKnowledgeCategoryId,
    title: row.title,
    content: row.content,
    tags: row.tags,
    serviceId: row.serviceId,
    servicePublicName: row.service?.publicName ?? null,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    updatedByUserName: row.updatedByUser?.name ?? null,
  };
}

function normalizeStableKey(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_STABLE_KEY || !STABLE_KEY_RE.test(trimmed)) {
    throw new BotKnowledgeEntryError(
      "stableKey: только a-z, 0-9 и дефисы, до 120 символов",
      "VALIDATION",
    );
  }
  return trimmed;
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TITLE) {
    throw new BotKnowledgeEntryError("title обязателен (до 200 символов)", "VALIDATION");
  }
  return trimmed;
}

function normalizeContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CONTENT) {
    throw new BotKnowledgeEntryError(
      "content обязателен (до 20000 символов)",
      "VALIDATION",
    );
  }
  return trimmed;
}

function normalizeTags(value: string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    throw new BotKnowledgeEntryError("tags: до 20 строк", "VALIDATION");
  }
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new BotKnowledgeEntryError("tags: только строки", "VALIDATION");
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_TAG) {
      throw new BotKnowledgeEntryError("tag: 1–64 символа", "VALIDATION");
    }
    tags.push(trimmed);
  }
  return tags;
}

function normalizeCategory(value: string): BotKnowledgeCategory {
  if (!ALLOWED_CATEGORIES.has(value)) {
    throw new BotKnowledgeEntryError("Некорректная category", "VALIDATION");
  }
  return value as BotKnowledgeCategory;
}

function normalizeServiceId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (!UUID_RE.test(value)) {
    throw new BotKnowledgeEntryError("serviceId должен быть UUID", "VALIDATION");
  }
  return value;
}

function assertNoPriceCopy(title: string, content: string): void {
  try {
    assertNoObviousPriceCopy(`${title}\n${content}`);
  } catch {
    throw new BotKnowledgeEntryError(
      "Контент похож на копирование цены (₽ / руб.). Цены только из live SoT.",
      "VALIDATION",
    );
  }
}

async function assertServiceExists(serviceId: string | null): Promise<void> {
  if (!serviceId) {
    return;
  }
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true },
  });
  if (!service) {
    throw new BotKnowledgeEntryError("Услуга не найдена", "VALIDATION");
  }
}

export async function listBotKnowledgeEntries(filters?: {
  category?: string;
  enabled?: "all" | "enabled" | "archived";
}): Promise<BotKnowledgeEntryDto[]> {
  const where: Prisma.BotKnowledgeEntryWhereInput = {};
  if (filters?.category && ALLOWED_CATEGORIES.has(filters.category)) {
    where.category = filters.category as BotKnowledgeCategory;
  }
  if (filters?.enabled === "enabled") {
    where.isEnabled = true;
  } else if (filters?.enabled === "archived") {
    where.isEnabled = false;
  }

  const rows = await prisma.botKnowledgeEntry.findMany({
    where,
    orderBy: [{ category: "asc" }, { stableKey: "asc" }],
    select: entrySelect,
  });
  return rows.map(mapEntry);
}

export async function getBotKnowledgeEntry(id: string): Promise<BotKnowledgeEntryDto> {
  if (!id || !UUID_RE.test(id)) {
    throw new BotKnowledgeEntryError("Запись не найдена", "NOT_FOUND");
  }
  const row = await prisma.botKnowledgeEntry.findUnique({
    where: { id },
    select: entrySelect,
  });
  if (!row) {
    throw new BotKnowledgeEntryError("Запись не найдена", "NOT_FOUND");
  }
  return mapEntry(row);
}

export async function createBotKnowledgeEntry(
  input: BotKnowledgeEntryCreateInput,
  userId: string,
): Promise<BotKnowledgeEntryDto> {
  const stableKey = normalizeStableKey(input.stableKey);
  const category = normalizeCategory(input.category);
  const title = normalizeTitle(input.title);
  const content = normalizeContent(input.content);
  const tags = normalizeTags(input.tags);
  const serviceId = normalizeServiceId(input.serviceId) ?? null;
  const isEnabled = input.isEnabled !== false;

  assertNoPriceCopy(title, content);
  await assertServiceExists(serviceId);

  try {
    const row = await prisma.botKnowledgeEntry.create({
      data: {
        stableKey,
        category,
        title,
        content,
        tags,
        serviceId,
        isEnabled,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      select: entrySelect,
    });
    return mapEntry(row);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new BotKnowledgeEntryError("stableKey уже занят", "CONFLICT");
    }
    throw error;
  }
}

export async function updateBotKnowledgeEntry(
  id: string,
  input: BotKnowledgeEntryWriteInput,
  userId: string,
): Promise<BotKnowledgeEntryDto> {
  if (!id || !UUID_RE.test(id)) {
    throw new BotKnowledgeEntryError("Запись не найдена", "NOT_FOUND");
  }

  const existing = await prisma.botKnowledgeEntry.findUnique({
    where: { id },
    select: {
      id: true,
      stableKey: true,
      title: true,
      content: true,
    },
  });
  if (!existing) {
    throw new BotKnowledgeEntryError("Запись не найдена", "NOT_FOUND");
  }

  if (input.stableKey !== undefined) {
    const nextKey = normalizeStableKey(input.stableKey);
    if (nextKey !== existing.stableKey) {
      throw new BotKnowledgeEntryError(
        "stableKey нельзя менять после создания. Создайте новую запись с новым ключом.",
        "VALIDATION",
      );
    }
  }

  const data: Prisma.BotKnowledgeEntryUpdateInput = {
    updatedByUser: { connect: { id: userId } },
  };

  if (input.category !== undefined) {
    data.category = normalizeCategory(input.category);
  }
  if (input.title !== undefined) {
    data.title = normalizeTitle(input.title);
  }
  if (input.content !== undefined) {
    data.content = normalizeContent(input.content);
  }
  if (input.tags !== undefined) {
    data.tags = normalizeTags(input.tags);
  }
  if (input.serviceId !== undefined) {
    const serviceId = normalizeServiceId(input.serviceId) ?? null;
    await assertServiceExists(serviceId);
    data.service =
      serviceId === null ? { disconnect: true } : { connect: { id: serviceId } };
  }
  if (input.isEnabled !== undefined) {
    if (typeof input.isEnabled !== "boolean") {
      throw new BotKnowledgeEntryError("isEnabled должен быть boolean", "VALIDATION");
    }
    data.isEnabled = input.isEnabled;
  }

  const nextTitle =
    typeof data.title === "string" ? data.title : existing.title;
  const nextContent =
    typeof data.content === "string" ? data.content : existing.content;
  assertNoPriceCopy(nextTitle, nextContent);

  const row = await prisma.botKnowledgeEntry.update({
    where: { id },
    data,
    select: entrySelect,
  });
  return mapEntry(row);
}

export async function listBotKnowledgeServiceOptions(): Promise<
  BotKnowledgeServiceOptionDto[]
> {
  const rows = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { publicName: "asc" },
    take: 300,
    select: { id: true, publicName: true },
  });
  return rows.map((row) => ({ id: row.id, publicName: row.publicName }));
}
