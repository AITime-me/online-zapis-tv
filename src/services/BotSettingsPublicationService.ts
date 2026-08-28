import "server-only";

import {
  BotSettingsPublicationStatus,
  type BotSettingsPublication,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { BOT_SETTINGS_ID } from "@/lib/bot-settings/defaults";
import {
  assertValidBotSettingsPublicationPayload,
  BotSettingsPublicationPayloadError,
  buildBotSettingsPublicationPayloadFromDraft,
  hashBotSettingsPublicationPayload,
} from "@/lib/bot-settings/publication-payload";
import { evaluateFoundationBotReadiness } from "@/lib/bot-settings/readiness";
import {
  BotSettingsValidationError,
} from "@/services/BotSettingsService";
import type {
  BotSettingsPublicationStateDto,
  BotSettingsPublicationSummaryDto,
  BotSettingsPublishResultDto,
  BotSettingsRuntimePublicationDto,
} from "@/types/bot-settings-publication";

export class BotSettingsPublicationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT"
      | "NOT_PUBLISHED" = "VALIDATION",
  ) {
    super(message);
    this.name = "BotSettingsPublicationError";
  }
}

type TransactionClient = Prisma.TransactionClient;

const draftSelect = {
  id: true,
  isEnabled: true,
  mode: true,
  provider: true,
  responseMode: true,
  channels: true,
  mainInstruction: true,
  knowledgeBaseNote: true,
  handoffRules: true,
  taggingRules: true,
  safetyRules: true,
  maxMessagesPerClient: true,
  maxDailyMessages: true,
  logRetentionDays: true,
  errorLogRetentionDays: true,
  maxStoredBotEvents: true,
  updatedAt: true,
} satisfies Prisma.BotSettingsSelect;

const publicationSelect = {
  id: true,
  versionNumber: true,
  status: true,
  schemaVersion: true,
  payloadChecksum: true,
  publishedAt: true,
  publishedByUserId: true,
  sourceUpdatedAt: true,
  supersededAt: true,
  publishedByUser: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BotSettingsPublicationSelect;

type PublicationRow = Prisma.BotSettingsPublicationGetPayload<{
  select: typeof publicationSelect;
}>;

function mapPublicationSummary(row: PublicationRow): BotSettingsPublicationSummaryDto {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status === BotSettingsPublicationStatus.ACTIVE ? "ACTIVE" : "SUPERSEDED",
    schemaVersion: row.schemaVersion,
    payloadChecksum: row.payloadChecksum,
    publishedAt: row.publishedAt.toISOString(),
    publishedByUserId: row.publishedByUserId,
    publishedByUserName: row.publishedByUser?.name ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

async function withSerializedBotSettingsPublication<T>(
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bot_settings WHERE id = ${BOT_SETTINGS_ID} FOR UPDATE
    `;
    if (locked.length !== 1) {
      throw new BotSettingsPublicationError("Настройки бота не найдены", "NOT_FOUND");
    }
    return fn(tx);
  });
}

async function loadDraftRowInTx(tx: TransactionClient) {
  const row = await tx.botSettings.findUnique({
    where: { id: BOT_SETTINGS_ID },
    select: draftSelect,
  });
  if (!row) {
    throw new BotSettingsPublicationError("Настройки бота не найдены", "NOT_FOUND");
  }
  return row;
}

async function loadDraftRow() {
  const row = await prisma.botSettings.findUnique({
    where: { id: BOT_SETTINGS_ID },
    select: draftSelect,
  });
  if (!row) {
    throw new BotSettingsPublicationError("Настройки бота не найдены", "NOT_FOUND");
  }
  return row;
}

function validateDraftForPublication(row: Awaited<ReturnType<typeof loadDraftRow>>) {
  const mapped = buildBotSettingsPublicationPayloadFromDraft(row);
  const readiness = evaluateFoundationBotReadiness({
    mode: mapped.desiredAdminState.mode,
    isEnabled: mapped.desiredAdminState.isEnabled,
    provider: mapped.provider,
    channels: mapped.channels,
  });

  if (mapped.desiredAdminState.mode === "AUTO" && !readiness.canEnableAuto) {
    throw new BotSettingsValidationError(
      "Нельзя опубликовать режим «Автоответ клиенту»: не пройдены readiness checks.",
    );
  }

  if (
    mapped.desiredAdminState.isEnabled &&
    mapped.desiredAdminState.mode === "AUTO" &&
    !readiness.canEnableAuto
  ) {
    throw new BotSettingsValidationError(
      "Нельзя опубликовать включённый AUTO: не пройдены readiness checks.",
    );
  }

  return mapped;
}

async function findActivePublicationInTx(tx: TransactionClient) {
  return tx.botSettingsPublication.findFirst({
    where: {
      botSettingsId: BOT_SETTINGS_ID,
      status: BotSettingsPublicationStatus.ACTIVE,
    },
    select: publicationSelect,
  });
}

export async function getBotSettingsPublicationState(): Promise<BotSettingsPublicationStateDto> {
  const [draft, active, recent] = await Promise.all([
    loadDraftRow(),
    prisma.botSettingsPublication.findFirst({
      where: {
        botSettingsId: BOT_SETTINGS_ID,
        status: BotSettingsPublicationStatus.ACTIVE,
      },
      select: publicationSelect,
    }),
    prisma.botSettingsPublication.findMany({
      where: { botSettingsId: BOT_SETTINGS_ID },
      orderBy: { versionNumber: "desc" },
      take: 8,
      select: publicationSelect,
    }),
  ]);

  const draftPayload = buildBotSettingsPublicationPayloadFromDraft(draft);
  const draftPayloadChecksum = hashBotSettingsPublicationPayload(draftPayload);
  const activeSummary = active ? mapPublicationSummary(active) : null;

  return {
    draftUpdatedAt: draft.updatedAt.toISOString(),
    draftPayloadChecksum,
    active: activeSummary,
    hasUnpublishedChanges:
      activeSummary === null || activeSummary.payloadChecksum !== draftPayloadChecksum,
    recentPublications: recent.map(mapPublicationSummary),
  };
}

export async function listBotSettingsPublications(
  limit = 20,
): Promise<BotSettingsPublicationSummaryDto[]> {
  const rows = await prisma.botSettingsPublication.findMany({
    where: { botSettingsId: BOT_SETTINGS_ID },
    orderBy: { versionNumber: "desc" },
    take: Math.max(1, Math.min(limit, 50)),
    select: publicationSelect,
  });
  return rows.map(mapPublicationSummary);
}

export async function publishCurrentBotSettings(
  publishedByUserId: string,
): Promise<BotSettingsPublishResultDto> {
  return withSerializedBotSettingsPublication(async (tx) => {
    const draft = await loadDraftRowInTx(tx);
    const payload = validateDraftForPublication(draft);
    const payloadChecksum = hashBotSettingsPublicationPayload(payload);
    const sourceUpdatedAt = draft.updatedAt;

    const existingActive = await findActivePublicationInTx(tx);
    if (existingActive && existingActive.payloadChecksum === payloadChecksum) {
      return {
        outcome: "UNCHANGED",
        publication: mapPublicationSummary(existingActive),
      };
    }

    const activeRows = await tx.botSettingsPublication.findMany({
      where: {
        botSettingsId: BOT_SETTINGS_ID,
        status: BotSettingsPublicationStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (activeRows.length > 1) {
      throw new BotSettingsPublicationError(
        "Обнаружено несколько ACTIVE публикаций",
        "CONFLICT",
      );
    }

    const now = new Date();
    if (activeRows.length === 1) {
      await tx.botSettingsPublication.update({
        where: { id: activeRows[0].id },
        data: {
          status: BotSettingsPublicationStatus.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const latest = await tx.botSettingsPublication.findFirst({
      where: { botSettingsId: BOT_SETTINGS_ID },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const publication = await tx.botSettingsPublication.create({
      data: {
        botSettingsId: BOT_SETTINGS_ID,
        versionNumber,
        status: BotSettingsPublicationStatus.ACTIVE,
        schemaVersion: payload.schemaVersion,
        payload: payload as unknown as Prisma.InputJsonValue,
        payloadChecksum,
        sourceUpdatedAt,
        publishedAt: now,
        publishedByUserId,
      },
      select: publicationSelect,
    });

    await tx.botSettings.update({
      where: { id: BOT_SETTINGS_ID },
      data: { activePublicationId: publication.id },
    });

    return {
      outcome: "PUBLISHED",
      publication: mapPublicationSummary(publication),
    };
  });
}

export async function activateBotSettingsPublication(
  publicationId: string,
  _activatedByUserId: string,
): Promise<BotSettingsPublicationSummaryDto> {
  if (!publicationId || publicationId.length > 64) {
    throw new BotSettingsPublicationError("Некорректная публикация", "NOT_FOUND");
  }

  return withSerializedBotSettingsPublication(async (tx) => {
    const target = await tx.botSettingsPublication.findFirst({
      where: {
        id: publicationId,
        botSettingsId: BOT_SETTINGS_ID,
      },
      select: publicationSelect,
    });

    if (!target) {
      throw new BotSettingsPublicationError("Публикация не найдена", "NOT_FOUND");
    }

    if (target.status === BotSettingsPublicationStatus.ACTIVE) {
      return mapPublicationSummary(target);
    }

    const activeRows = await tx.botSettingsPublication.findMany({
      where: {
        botSettingsId: BOT_SETTINGS_ID,
        status: BotSettingsPublicationStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (activeRows.length > 1) {
      throw new BotSettingsPublicationError(
        "Обнаружено несколько ACTIVE публикаций",
        "CONFLICT",
      );
    }

    const now = new Date();
    if (activeRows.length === 1 && activeRows[0].id !== publicationId) {
      await tx.botSettingsPublication.update({
        where: { id: activeRows[0].id },
        data: {
          status: BotSettingsPublicationStatus.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const updated = await tx.botSettingsPublication.update({
      where: { id: publicationId },
      data: {
        status: BotSettingsPublicationStatus.ACTIVE,
        supersededAt: null,
      },
      select: publicationSelect,
    });

    await tx.botSettings.update({
      where: { id: BOT_SETTINGS_ID },
      data: { activePublicationId: publicationId },
    });

    return mapPublicationSummary(updated);
  });
}

export async function getActiveBotSettingsRuntimePublication(): Promise<BotSettingsRuntimePublicationDto | null> {
  const row = await prisma.botSettingsPublication.findFirst({
    where: {
      botSettingsId: BOT_SETTINGS_ID,
      status: BotSettingsPublicationStatus.ACTIVE,
    },
    select: {
      id: true,
      versionNumber: true,
      schemaVersion: true,
      payload: true,
      payloadChecksum: true,
      publishedAt: true,
      sourceUpdatedAt: true,
    },
  });

  if (!row) {
    return null;
  }

  let payload;
  try {
    payload = assertValidBotSettingsPublicationPayload(row.payload);
  } catch (error) {
    if (error instanceof BotSettingsPublicationPayloadError) {
      throw new BotSettingsPublicationError(
        "ACTIVE публикация содержит некорректный payload",
        "CONFLICT",
      );
    }
    throw error;
  }

  const checksum = hashBotSettingsPublicationPayload(payload);
  if (checksum !== row.payloadChecksum) {
    throw new BotSettingsPublicationError(
      "Checksum ACTIVE публикации не совпадает с payload",
      "CONFLICT",
    );
  }

  return {
    schemaVersion: row.schemaVersion,
    publicationId: row.id,
    version: row.versionNumber,
    checksum: row.payloadChecksum,
    publishedAt: row.publishedAt.toISOString(),
    sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
    settings: payload,
  };
}

export type { BotSettingsPublication };
