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
import {
  BOT_KNOWLEDGE_MAX_STABLE_KEY,
  BOT_KNOWLEDGE_STABLE_KEY_HINT,
  BOT_KNOWLEDGE_STABLE_KEY_RE,
} from "@/lib/bot-knowledge/stable-key";
import type {
  BotKnowledgeEntryCreateInput,
  BotKnowledgeEntryDto,
  BotKnowledgeEntryWriteInput,
  BotKnowledgeImportResultDto,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_STABLE_KEY = BOT_KNOWLEDGE_MAX_STABLE_KEY;
const MAX_TITLE = 200;
const MAX_CONTENT = 20_000;
const MAX_TAG = 64;
const MAX_TAGS = 20;

/** Hard caps for bulk draft import (not publish). */
export const BOT_KNOWLEDGE_IMPORT_MAX_ENTRIES = 500;
export const BOT_KNOWLEDGE_IMPORT_MAX_BYTES = 2_000_000;

const IMPORT_TOP_LEVEL_KEYS = ["schemaVersion", "entries"] as const;
const IMPORT_ENTRY_KEYS = [
  "key",
  "category",
  "title",
  "content",
  "tags",
  "serviceId",
] as const;

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
  if (
    !trimmed ||
    trimmed.length > MAX_STABLE_KEY ||
    !BOT_KNOWLEDGE_STABLE_KEY_RE.test(trimmed)
  ) {
    throw new BotKnowledgeEntryError(BOT_KNOWLEDGE_STABLE_KEY_HINT, "VALIDATION");
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

type NormalizedImportEntry = {
  stableKey: string;
  category: BotKnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  serviceId: string | null;
};

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length) {
    throw new BotKnowledgeEntryError(
      `${label}: недопустимая структура полей`,
      "VALIDATION",
    );
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new BotKnowledgeEntryError(
        `${label}: отсутствует поле ${key}`,
        "VALIDATION",
      );
    }
  }
  for (const key of keys) {
    if (!allowed.includes(key)) {
      throw new BotKnowledgeEntryError(
        `${label}: неизвестное поле ${key}`,
        "VALIDATION",
      );
    }
  }
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function entryContentEqual(
  existing: {
    category: string;
    title: string;
    content: string;
    tags: string[];
    serviceId: string | null;
  },
  next: NormalizedImportEntry,
): boolean {
  return (
    existing.category === next.category &&
    existing.title === next.title &&
    existing.content === next.content &&
    tagsEqual(existing.tags, next.tags) &&
    existing.serviceId === next.serviceId
  );
}

/**
 * Validate the entire import file first, then upsert workspace drafts by stableKey.
 * Does not publish, does not touch BotSettings, does not change isEnabled on update.
 */
export async function importBotKnowledgeEntries(
  raw: unknown,
  userId: string,
): Promise<BotKnowledgeImportResultDto> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BotKnowledgeEntryError("Некорректное тело импорта", "VALIDATION");
  }

  const root = raw as Record<string, unknown>;
  assertExactKeys(root, IMPORT_TOP_LEVEL_KEYS, "import");

  if (root.schemaVersion !== 1) {
    throw new BotKnowledgeEntryError(
      "Поддерживается только schemaVersion=1",
      "VALIDATION",
    );
  }

  if (!Array.isArray(root.entries)) {
    throw new BotKnowledgeEntryError("entries должен быть массивом", "VALIDATION");
  }

  if (root.entries.length > BOT_KNOWLEDGE_IMPORT_MAX_ENTRIES) {
    throw new BotKnowledgeEntryError(
      `Слишком много записей (макс. ${BOT_KNOWLEDGE_IMPORT_MAX_ENTRIES})`,
      "VALIDATION",
    );
  }

  if (root.entries.length === 0) {
    return { total: 0, created: 0, updated: 0, unchanged: 0 };
  }

  const normalized: NormalizedImportEntry[] = [];
  const seenKeys = new Set<string>();

  for (let index = 0; index < root.entries.length; index += 1) {
    const item = root.entries[index];
    const label = `entries[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BotKnowledgeEntryError(`${label}: ожидается объект`, "VALIDATION");
    }
    const record = item as Record<string, unknown>;
    assertExactKeys(record, IMPORT_ENTRY_KEYS, label);

    if (typeof record.key !== "string") {
      throw new BotKnowledgeEntryError(`${label}.key: ожидается строка`, "VALIDATION");
    }
    if (typeof record.category !== "string") {
      throw new BotKnowledgeEntryError(
        `${label}.category: ожидается строка`,
        "VALIDATION",
      );
    }
    if (typeof record.title !== "string") {
      throw new BotKnowledgeEntryError(
        `${label}.title: ожидается строка`,
        "VALIDATION",
      );
    }
    if (typeof record.content !== "string") {
      throw new BotKnowledgeEntryError(
        `${label}.content: ожидается строка`,
        "VALIDATION",
      );
    }
    if (!Array.isArray(record.tags)) {
      throw new BotKnowledgeEntryError(
        `${label}.tags: ожидается массив строк`,
        "VALIDATION",
      );
    }
    if (record.serviceId !== null && typeof record.serviceId !== "string") {
      throw new BotKnowledgeEntryError(
        `${label}.serviceId: строка или null`,
        "VALIDATION",
      );
    }

    let stableKey: string;
    let category: BotKnowledgeCategory;
    let title: string;
    let content: string;
    let tags: string[];
    let serviceId: string | null;
    try {
      stableKey = normalizeStableKey(record.key);
      category = normalizeCategory(record.category);
      title = normalizeTitle(record.title);
      content = normalizeContent(record.content);
      tags = normalizeTags(record.tags as string[]);
      serviceId = normalizeServiceId(record.serviceId) ?? null;
      assertNoPriceCopy(title, content);
    } catch (error) {
      if (error instanceof BotKnowledgeEntryError) {
        throw new BotKnowledgeEntryError(
          `${label}: ${error.message}`,
          error.code,
        );
      }
      throw error;
    }

    if (seenKeys.has(stableKey)) {
      throw new BotKnowledgeEntryError(
        `Дубликат key в файле: ${stableKey}`,
        "VALIDATION",
      );
    }
    seenKeys.add(stableKey);

    normalized.push({
      stableKey,
      category,
      title,
      content,
      tags,
      serviceId,
    });
  }

  const serviceIds = [
    ...new Set(
      normalized
        .map((entry) => entry.serviceId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  if (serviceIds.length > 0) {
    const found = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    });
    const foundSet = new Set(found.map((row) => row.id));
    for (const serviceId of serviceIds) {
      if (!foundSet.has(serviceId)) {
        throw new BotKnowledgeEntryError("Услуга не найдена", "VALIDATION");
      }
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  try {
    await prisma.$transaction(async (tx) => {
      const existingRows = await tx.botKnowledgeEntry.findMany({
        where: { stableKey: { in: [...seenKeys] } },
        select: {
          id: true,
          stableKey: true,
          category: true,
          title: true,
          content: true,
          tags: true,
          serviceId: true,
          isEnabled: true,
        },
      });
      const existingByKey = new Map(
        existingRows.map((row) => [row.stableKey, row] as const),
      );

      for (const entry of normalized) {
        const existing = existingByKey.get(entry.stableKey);
        if (!existing) {
          await tx.botKnowledgeEntry.create({
            data: {
              stableKey: entry.stableKey,
              category: entry.category,
              title: entry.title,
              content: entry.content,
              tags: entry.tags,
              serviceId: entry.serviceId,
              isEnabled: true,
              createdByUserId: userId,
              updatedByUserId: userId,
            },
          });
          created += 1;
          continue;
        }

        if (entryContentEqual(existing, entry)) {
          unchanged += 1;
          continue;
        }

        await tx.botKnowledgeEntry.update({
          where: { id: existing.id },
          data: {
            category: entry.category,
            title: entry.title,
            content: entry.content,
            tags: entry.tags,
            service:
              entry.serviceId === null
                ? { disconnect: true }
                : { connect: { id: entry.serviceId } },
            updatedByUser: { connect: { id: userId } },
            // intentionally do not touch isEnabled / publications
          },
        });
        updated += 1;
      }
    });
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

  return {
    total: normalized.length,
    created,
    updated,
    unchanged,
  };
}
