import "server-only";

import {
  BotKnowledgePublicationStatus,
  type BotKnowledgePublication,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BOT_KNOWLEDGE_WORKSPACE_ID,
  type BotKnowledgePublicationPayloadV1,
} from "@/lib/bot-knowledge/publication-contract";
import {
  assertValidBotKnowledgePublicationPayload,
  BotKnowledgePublicationPayloadError,
  buildBotKnowledgePublicationPayloadFromEntries,
  hashBotKnowledgePublicationPayload,
  type KnowledgeEntryDraftForPublish,
} from "@/lib/bot-knowledge/publication-payload";
import type {
  BotKnowledgePublicationStateDto,
  BotKnowledgePublicationSummaryDto,
  BotKnowledgePublishResultDto,
  BotKnowledgeRuntimePublicationDto,
} from "@/types/bot-knowledge";

export class BotKnowledgePublicationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT"
      | "NOT_PUBLISHED" = "VALIDATION",
  ) {
    super(message);
    this.name = "BotKnowledgePublicationError";
  }
}

type TransactionClient = Prisma.TransactionClient;

const entryDraftSelect = {
  stableKey: true,
  category: true,
  title: true,
  content: true,
  tags: true,
  serviceId: true,
  isEnabled: true,
} satisfies Prisma.BotKnowledgeEntrySelect;

const publicationSelect = {
  id: true,
  versionNumber: true,
  status: true,
  schemaVersion: true,
  payload: true,
  payloadChecksum: true,
  publishedAt: true,
  publishedByUserId: true,
  supersededAt: true,
  publishedByUser: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BotKnowledgePublicationSelect;

type PublicationRow = Prisma.BotKnowledgePublicationGetPayload<{
  select: typeof publicationSelect;
}>;

function entryCountFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return 0;
  }
  const entries = (payload as { entries?: unknown }).entries;
  return Array.isArray(entries) ? entries.length : 0;
}

function mapPublicationSummary(row: PublicationRow): BotKnowledgePublicationSummaryDto {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status === BotKnowledgePublicationStatus.ACTIVE ? "ACTIVE" : "SUPERSEDED",
    schemaVersion: row.schemaVersion,
    payloadChecksum: row.payloadChecksum,
    publishedAt: row.publishedAt.toISOString(),
    publishedByUserId: row.publishedByUserId,
    publishedByUserName: row.publishedByUser?.name ?? null,
    entryCount: entryCountFromPayload(row.payload),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

async function ensureWorkspaceLocked(tx: TransactionClient): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO bot_knowledge_workspace (id)
    VALUES (${BOT_KNOWLEDGE_WORKSPACE_ID})
    ON CONFLICT (id) DO NOTHING
  `;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM bot_knowledge_workspace WHERE id = ${BOT_KNOWLEDGE_WORKSPACE_ID} FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new BotKnowledgePublicationError(
      "Knowledge workspace не найден",
      "NOT_FOUND",
    );
  }
}

async function withSerializedKnowledgePublication<T>(
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await ensureWorkspaceLocked(tx);
    return fn(tx);
  });
}

async function loadEnabledDraftsInTx(
  tx: TransactionClient,
): Promise<KnowledgeEntryDraftForPublish[]> {
  const rows = await tx.botKnowledgeEntry.findMany({
    select: entryDraftSelect,
  });
  return rows.map((row) => ({
    stableKey: row.stableKey,
    category: row.category,
    title: row.title,
    content: row.content,
    tags: row.tags,
    serviceId: row.serviceId,
    isEnabled: row.isEnabled,
  }));
}

function buildPayloadFromDrafts(rows: KnowledgeEntryDraftForPublish[]) {
  try {
    return buildBotKnowledgePublicationPayloadFromEntries(rows);
  } catch (error) {
    if (error instanceof BotKnowledgePublicationPayloadError) {
      throw new BotKnowledgePublicationError(
        `Некорректный knowledge payload: ${error.code}`,
        "VALIDATION",
      );
    }
    throw error;
  }
}

function assertPayloadOrConflict(payload: unknown): BotKnowledgePublicationPayloadV1 {
  try {
    return assertValidBotKnowledgePublicationPayload(payload);
  } catch (error) {
    if (error instanceof BotKnowledgePublicationPayloadError) {
      throw new BotKnowledgePublicationError(
        "ACTIVE публикация содержит некорректный payload",
        "CONFLICT",
      );
    }
    throw error;
  }
}

async function findActivePublicationInTx(tx: TransactionClient) {
  return tx.botKnowledgePublication.findFirst({
    where: {
      workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
      status: BotKnowledgePublicationStatus.ACTIVE,
    },
    select: publicationSelect,
  });
}

export async function getBotKnowledgePublicationState(): Promise<BotKnowledgePublicationStateDto> {
  const [workspace, entries, active, recent] = await Promise.all([
    prisma.botKnowledgeWorkspace.findUnique({
      where: { id: BOT_KNOWLEDGE_WORKSPACE_ID },
      select: { updatedAt: true },
    }),
    prisma.botKnowledgeEntry.findMany({
      select: {
        ...entryDraftSelect,
        updatedAt: true,
      },
    }),
    prisma.botKnowledgePublication.findFirst({
      where: {
        workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
        status: BotKnowledgePublicationStatus.ACTIVE,
      },
      select: publicationSelect,
    }),
    prisma.botKnowledgePublication.findMany({
      where: { workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID },
      orderBy: { versionNumber: "desc" },
      take: 8,
      select: publicationSelect,
    }),
  ]);

  const draftPayload = buildPayloadFromDrafts(
    entries.map((row) => ({
      stableKey: row.stableKey,
      category: row.category,
      title: row.title,
      content: row.content,
      tags: row.tags,
      serviceId: row.serviceId,
      isEnabled: row.isEnabled,
    })),
  );
  const draftPayloadChecksum = hashBotKnowledgePublicationPayload(draftPayload);
  const activeSummary = active ? mapPublicationSummary(active) : null;
  const enabledEntryCount = entries.filter((row) => row.isEnabled).length;
  const latestEntryUpdatedAt = entries.reduce<Date | null>((latest, row) => {
    if (!latest || row.updatedAt > latest) {
      return row.updatedAt;
    }
    return latest;
  }, null);
  const draftUpdatedAt =
    latestEntryUpdatedAt ?? workspace?.updatedAt ?? null;

  return {
    workspaceUpdatedAt: draftUpdatedAt?.toISOString() ?? null,
    draftPayloadChecksum,
    active: activeSummary,
    hasUnpublishedChanges:
      activeSummary === null || activeSummary.payloadChecksum !== draftPayloadChecksum,
    recentPublications: recent.map(mapPublicationSummary),
    enabledEntryCount,
  };
}

export async function listBotKnowledgePublications(
  limit = 20,
): Promise<BotKnowledgePublicationSummaryDto[]> {
  const rows = await prisma.botKnowledgePublication.findMany({
    where: { workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID },
    orderBy: { versionNumber: "desc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: publicationSelect,
  });
  return rows.map(mapPublicationSummary);
}

export async function publishCurrentKnowledge(
  publishedByUserId: string,
): Promise<BotKnowledgePublishResultDto> {
  return withSerializedKnowledgePublication(async (tx) => {
    const drafts = await loadEnabledDraftsInTx(tx);
    const payload = buildPayloadFromDrafts(drafts);
    const payloadChecksum = hashBotKnowledgePublicationPayload(payload);

    const existingActive = await findActivePublicationInTx(tx);
    if (existingActive && existingActive.payloadChecksum === payloadChecksum) {
      return {
        outcome: "UNCHANGED",
        publication: mapPublicationSummary(existingActive),
      };
    }

    const activeRows = await tx.botKnowledgePublication.findMany({
      where: {
        workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
        status: BotKnowledgePublicationStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (activeRows.length > 1) {
      throw new BotKnowledgePublicationError(
        "Обнаружено несколько ACTIVE knowledge публикаций",
        "CONFLICT",
      );
    }

    const now = new Date();
    if (activeRows.length === 1) {
      await tx.botKnowledgePublication.update({
        where: { id: activeRows[0].id },
        data: {
          status: BotKnowledgePublicationStatus.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const latest = await tx.botKnowledgePublication.findFirst({
      where: { workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const publication = await tx.botKnowledgePublication.create({
      data: {
        workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
        versionNumber,
        status: BotKnowledgePublicationStatus.ACTIVE,
        schemaVersion: payload.schemaVersion,
        payload: payload as unknown as Prisma.InputJsonValue,
        payloadChecksum,
        publishedAt: now,
        publishedByUserId,
      },
      select: publicationSelect,
    });

    await tx.botKnowledgeWorkspace.update({
      where: { id: BOT_KNOWLEDGE_WORKSPACE_ID },
      data: { activePublicationId: publication.id },
    });

    return {
      outcome: "PUBLISHED",
      publication: mapPublicationSummary(publication),
    };
  });
}

export async function activateKnowledgePublication(
  publicationId: string,
  _activatedByUserId: string,
): Promise<BotKnowledgePublicationSummaryDto> {
  if (!publicationId || publicationId.length > 64) {
    throw new BotKnowledgePublicationError("Некорректная публикация", "NOT_FOUND");
  }

  return withSerializedKnowledgePublication(async (tx) => {
    const target = await tx.botKnowledgePublication.findFirst({
      where: {
        id: publicationId,
        workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
      },
      select: publicationSelect,
    });

    if (!target) {
      throw new BotKnowledgePublicationError("Публикация не найдена", "NOT_FOUND");
    }

    const validatedPayload = assertPayloadOrConflict(target.payload);
    const checksum = hashBotKnowledgePublicationPayload(validatedPayload);
    if (checksum !== target.payloadChecksum) {
      throw new BotKnowledgePublicationError(
        "Checksum публикации не совпадает с payload",
        "CONFLICT",
      );
    }

    if (target.status === BotKnowledgePublicationStatus.ACTIVE) {
      return mapPublicationSummary(target);
    }

    const activeRows = await tx.botKnowledgePublication.findMany({
      where: {
        workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
        status: BotKnowledgePublicationStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (activeRows.length > 1) {
      throw new BotKnowledgePublicationError(
        "Обнаружено несколько ACTIVE knowledge публикаций",
        "CONFLICT",
      );
    }

    const now = new Date();
    if (activeRows.length === 1 && activeRows[0].id !== publicationId) {
      await tx.botKnowledgePublication.update({
        where: { id: activeRows[0].id },
        data: {
          status: BotKnowledgePublicationStatus.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const updated = await tx.botKnowledgePublication.update({
      where: { id: publicationId },
      data: {
        status: BotKnowledgePublicationStatus.ACTIVE,
        supersededAt: null,
      },
      select: publicationSelect,
    });

    await tx.botKnowledgeWorkspace.update({
      where: { id: BOT_KNOWLEDGE_WORKSPACE_ID },
      data: { activePublicationId: publicationId },
    });

    return mapPublicationSummary(updated);
  });
}

export async function getActiveBotKnowledgeRuntimePublication(): Promise<BotKnowledgeRuntimePublicationDto | null> {
  const row = await prisma.botKnowledgePublication.findFirst({
    where: {
      workspaceId: BOT_KNOWLEDGE_WORKSPACE_ID,
      status: BotKnowledgePublicationStatus.ACTIVE,
    },
    select: {
      id: true,
      versionNumber: true,
      schemaVersion: true,
      payload: true,
      payloadChecksum: true,
      publishedAt: true,
    },
  });

  if (!row) {
    return null;
  }

  const payload = assertPayloadOrConflict(row.payload);
  const checksum = hashBotKnowledgePublicationPayload(payload);
  if (checksum !== row.payloadChecksum) {
    throw new BotKnowledgePublicationError(
      "Checksum ACTIVE публикации не совпадает с payload",
      "CONFLICT",
    );
  }

  return {
    schemaVersion: row.schemaVersion,
    knowledgePublicationId: row.id,
    version: row.versionNumber,
    checksum: row.payloadChecksum,
    publishedAt: row.publishedAt.toISOString(),
    entries: payload.entries,
  };
}

export type { BotKnowledgePublication };
