import { createHash } from "node:crypto";

import {
  BOT_KNOWLEDGE_CATEGORIES,
  BOT_KNOWLEDGE_CATEGORY_ORDER,
  BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS,
  BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION,
  type BotKnowledgeCategoryId,
  type BotKnowledgePublicationPayloadV1,
  type BotKnowledgePublishedEntryV1,
} from "@/lib/bot-knowledge/publication-contract";

export { BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION };

export class BotKnowledgePublicationPayloadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BotKnowledgePublicationPayloadError";
  }
}

const TOP_LEVEL_KEYS = ["schemaVersion", "entries"] as const;
const ENTRY_KEYS = ["key", "category", "title", "content", "tags", "serviceId"] as const;

const ALLOWED_CATEGORIES = new Set<string>(BOT_KNOWLEDGE_CATEGORIES);

const STABLE_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_STABLE_KEY = 120;
const MAX_TITLE = 200;
const MAX_CONTENT = 20_000;
const MAX_TAG = 64;
const MAX_TAGS = 20;
const MAX_ENTRIES = 500;

/** Obvious exact-price copy (not semantic AI validation). */
const OBVIOUS_PRICE_COPY_RE =
  /(?:\d[\d\s]{0,12}\s*(?:₽|руб\.?|рублей)|(?:₽|руб\.?|рублей)\s*\d[\d\s]{0,12})/iu;

function fail(code: string): never {
  throw new BotKnowledgePublicationPayloadError(code);
}

function assertPlainObject(
  value: unknown,
  code: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code);
  }
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length) {
    fail(code);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      fail(code);
    }
  }
  for (const key of keys) {
    if (!allowed.includes(key)) {
      fail(code);
    }
  }
}

function assertNonEmptyBoundedString(
  value: unknown,
  max: number,
  code: string,
): asserts value is string {
  if (typeof value !== "string") {
    fail(code);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || value.length > max) {
    fail(code);
  }
}

function assertStableKey(value: unknown): asserts value is string {
  assertNonEmptyBoundedString(value, MAX_STABLE_KEY, "BOT_KNOWLEDGE_ENTRY_KEY_INVALID");
  if (!STABLE_KEY_RE.test(value)) {
    fail("BOT_KNOWLEDGE_ENTRY_KEY_INVALID");
  }
}

function assertCategory(value: unknown): asserts value is BotKnowledgeCategoryId {
  if (typeof value !== "string" || !ALLOWED_CATEGORIES.has(value)) {
    fail("BOT_KNOWLEDGE_ENTRY_CATEGORY_INVALID");
  }
}

function assertNullableServiceId(value: unknown): asserts value is string | null {
  if (value === null) {
    return;
  }
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    fail("BOT_KNOWLEDGE_ENTRY_SERVICE_ID_INVALID");
  }
}

function assertTags(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    fail("BOT_KNOWLEDGE_ENTRY_TAGS_INVALID");
  }
  for (const tag of value) {
    if (typeof tag !== "string") {
      fail("BOT_KNOWLEDGE_ENTRY_TAGS_INVALID");
    }
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > MAX_TAG || tag.length > MAX_TAG) {
      fail("BOT_KNOWLEDGE_ENTRY_TAGS_INVALID");
    }
  }
}

function normalizeTagsForPayload(tags: string[]): string[] {
  return [...tags].map((tag) => tag.trim()).sort((a, b) => a.localeCompare(b));
}

function assertNoForbiddenLiveFactKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (
      (BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS as readonly string[]).includes(key)
    ) {
      fail("BOT_KNOWLEDGE_LIVE_FACT_FIELD_FORBIDDEN");
    }
  }
}

export function assertNoObviousPriceCopy(text: string): void {
  if (OBVIOUS_PRICE_COPY_RE.test(text)) {
    fail("BOT_KNOWLEDGE_OBVIOUS_PRICE_COPY");
  }
}

function categoryRank(category: BotKnowledgeCategoryId): number {
  const index = BOT_KNOWLEDGE_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareKnowledgeEntriesForPublish(
  a: Pick<BotKnowledgePublishedEntryV1, "category" | "key">,
  b: Pick<BotKnowledgePublishedEntryV1, "category" | "key">,
): number {
  const byCategory = categoryRank(a.category) - categoryRank(b.category);
  if (byCategory !== 0) {
    return byCategory;
  }
  return a.key.localeCompare(b.key);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashBotKnowledgePublicationPayload(
  payload: BotKnowledgePublicationPayloadV1,
): string {
  return createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

export type KnowledgeEntryDraftForPublish = {
  stableKey: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tags: string[];
  serviceId: string | null;
  isEnabled: boolean;
};

export function buildBotKnowledgePublicationPayloadFromEntries(
  rows: KnowledgeEntryDraftForPublish[],
): BotKnowledgePublicationPayloadV1 {
  if (rows.length > MAX_ENTRIES) {
    fail("BOT_KNOWLEDGE_ENTRIES_LIMIT");
  }

  const enabled = rows.filter((row) => row.isEnabled);
  const entries: BotKnowledgePublishedEntryV1[] = enabled.map((row) => {
    assertStableKey(row.stableKey);
    assertCategory(row.category);
    assertNonEmptyBoundedString(row.title, MAX_TITLE, "BOT_KNOWLEDGE_ENTRY_TITLE_INVALID");
    assertNonEmptyBoundedString(
      row.content,
      MAX_CONTENT,
      "BOT_KNOWLEDGE_ENTRY_CONTENT_INVALID",
    );
    assertTags(row.tags);
    assertNullableServiceId(row.serviceId);
    assertNoObviousPriceCopy(`${row.title}\n${row.content}`);

    return {
      key: row.stableKey,
      category: row.category,
      title: row.title.trim(),
      content: row.content.trim(),
      tags: normalizeTagsForPayload(row.tags),
      serviceId: row.serviceId,
    };
  });

  entries.sort(compareKnowledgeEntriesForPublish);

  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) {
      fail("BOT_KNOWLEDGE_ENTRY_KEY_DUPLICATE");
    }
    keys.add(entry.key);
  }

  const payload: BotKnowledgePublicationPayloadV1 = {
    schemaVersion: BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION,
    entries,
  };

  return assertValidBotKnowledgePublicationPayload(payload);
}

export function assertValidBotKnowledgePublicationPayload(
  payload: unknown,
): BotKnowledgePublicationPayloadV1 {
  assertPlainObject(payload, "BOT_KNOWLEDGE_PUBLICATION_PAYLOAD_INVALID");
  assertNoForbiddenLiveFactKeys(payload);
  assertExactKeys(payload, TOP_LEVEL_KEYS, "BOT_KNOWLEDGE_PUBLICATION_PAYLOAD_INVALID");

  if (payload.schemaVersion !== BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION) {
    fail("BOT_KNOWLEDGE_PUBLICATION_SCHEMA_UNSUPPORTED");
  }

  if (!Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) {
    fail("BOT_KNOWLEDGE_PUBLICATION_PAYLOAD_INVALID");
  }

  const entries: BotKnowledgePublishedEntryV1[] = [];
  const keys = new Set<string>();

  for (const raw of payload.entries) {
    assertPlainObject(raw, "BOT_KNOWLEDGE_PUBLICATION_PAYLOAD_INVALID");
    assertNoForbiddenLiveFactKeys(raw);
    assertExactKeys(raw, ENTRY_KEYS, "BOT_KNOWLEDGE_PUBLICATION_PAYLOAD_INVALID");
    assertStableKey(raw.key);
    assertCategory(raw.category);
    assertNonEmptyBoundedString(raw.title, MAX_TITLE, "BOT_KNOWLEDGE_ENTRY_TITLE_INVALID");
    assertNonEmptyBoundedString(
      raw.content,
      MAX_CONTENT,
      "BOT_KNOWLEDGE_ENTRY_CONTENT_INVALID",
    );
    assertTags(raw.tags);
    assertNullableServiceId(raw.serviceId);
    assertNoObviousPriceCopy(`${raw.title}\n${raw.content}`);

    const normalizedTags = normalizeTagsForPayload(raw.tags as string[]);
    const rawTags = raw.tags as string[];
    if (
      rawTags.length !== normalizedTags.length ||
      rawTags.some((tag, index) => tag !== normalizedTags[index])
    ) {
      fail("BOT_KNOWLEDGE_PUBLICATION_TAGS_ORDER_INVALID");
    }

    if (keys.has(raw.key)) {
      fail("BOT_KNOWLEDGE_ENTRY_KEY_DUPLICATE");
    }
    keys.add(raw.key);

    entries.push({
      key: raw.key,
      category: raw.category as BotKnowledgeCategoryId,
      title: raw.title,
      content: raw.content,
      tags: normalizedTags,
      serviceId: raw.serviceId as string | null,
    });
  }

  const sorted = [...entries].sort(compareKnowledgeEntriesForPublish);
  for (let index = 0; index < entries.length; index += 1) {
    if (
      entries[index].key !== sorted[index].key ||
      entries[index].category !== sorted[index].category
    ) {
      fail("BOT_KNOWLEDGE_PUBLICATION_ORDER_INVALID");
    }
  }

  return {
    schemaVersion: BOT_KNOWLEDGE_PUBLICATION_SCHEMA_VERSION,
    entries,
  };
}
