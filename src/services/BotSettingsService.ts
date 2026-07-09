import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BOT_MODE_LABELS,
  BOT_PROVIDER_LABELS,
  BOT_RESPONSE_MODE_LABELS,
  BOT_SETTINGS_ID,
  DEFAULT_BOT_CHANNELS,
  DEFAULT_BOT_SETTINGS,
  type BotChannels,
  type BotMode,
  type BotProvider,
  type BotResponseMode,
} from "@/lib/bot-settings/defaults";
import type { BotSettingsDto, BotSettingsWriteInput } from "@/types/bot-settings";

export class BotSettingsValidationError extends Error {}

const botSettingsSelect = {
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
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
  updatedByUser: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.BotSettingsSelect;

type BotSettingsRow = Prisma.BotSettingsGetPayload<{
  select: typeof botSettingsSelect;
}>;

function isBotMode(value: string): value is BotMode {
  return value in BOT_MODE_LABELS;
}

function isBotProvider(value: string): value is BotProvider {
  return value in BOT_PROVIDER_LABELS;
}

function isBotResponseMode(value: string): value is BotResponseMode {
  return value in BOT_RESPONSE_MODE_LABELS;
}

function parseChannels(value: Prisma.JsonValue): BotChannels {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_BOT_CHANNELS };
  }

  const record = value as Record<string, unknown>;
  return {
    siteWidget: Boolean(record.siteWidget),
    vk: Boolean(record.vk),
    max: Boolean(record.max),
    telegram: Boolean(record.telegram),
  };
}

function mapSettings(row: BotSettingsRow): BotSettingsDto {
  return {
    id: row.id,
    isEnabled: row.isEnabled,
    mode: isBotMode(row.mode) ? row.mode : "OFF",
    provider: isBotProvider(row.provider) ? row.provider : "YANDEX",
    responseMode: isBotResponseMode(row.responseMode)
      ? row.responseMode
      : "HINTS_ONLY",
    channels: parseChannels(row.channels),
    mainInstruction: row.mainInstruction,
    knowledgeBaseNote: row.knowledgeBaseNote,
    handoffRules: row.handoffRules,
    taggingRules: row.taggingRules,
    safetyRules: row.safetyRules,
    maxMessagesPerClient: row.maxMessagesPerClient,
    maxDailyMessages: row.maxDailyMessages,
    logRetentionDays: row.logRetentionDays,
    errorLogRetentionDays: row.errorLogRetentionDays,
    maxStoredBotEvents: row.maxStoredBotEvents,
    updatedByUserId: row.updatedByUserId,
    updatedByUserName: row.updatedByUser?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildCreateData(): Prisma.BotSettingsCreateInput {
  return {
    id: BOT_SETTINGS_ID,
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
  };
}

function buildDefaultUpdateData(): Prisma.BotSettingsUpdateInput {
  return {
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
    updatedByUser: { disconnect: true },
  };
}

function validatePositiveInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new BotSettingsValidationError(`${label} должно быть не меньше 1`);
  }
  return Math.trunc(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function ensureBotSettings(): Promise<BotSettingsRow> {
  const existing = await prisma.botSettings.findUnique({
    where: { id: BOT_SETTINGS_ID },
    select: botSettingsSelect,
  });

  if (existing) {
    return existing;
  }

  await prisma.botSettings.create({
    data: buildCreateData(),
  });

  return prisma.botSettings.findUniqueOrThrow({
    where: { id: BOT_SETTINGS_ID },
    select: botSettingsSelect,
  });
}

export async function getBotSettings(): Promise<BotSettingsDto> {
  const row = await ensureBotSettings();
  return mapSettings(row);
}

export async function updateBotSettings(
  input: BotSettingsWriteInput,
  updatedByUserId: string,
): Promise<BotSettingsDto> {
  await ensureBotSettings();

  const data: Prisma.BotSettingsUpdateInput = {
    updatedByUser: { connect: { id: updatedByUserId } },
  };

  if (input.isEnabled !== undefined) {
    data.isEnabled = input.isEnabled;
  }
  if (input.mode !== undefined) {
    if (!isBotMode(input.mode)) {
      throw new BotSettingsValidationError("Недопустимый режим бота");
    }
    data.mode = input.mode;
    if (input.mode === "OFF") {
      data.isEnabled = false;
    }
  }
  if (input.provider !== undefined) {
    if (!isBotProvider(input.provider)) {
      throw new BotSettingsValidationError("Недопустимый провайдер");
    }
    data.provider = input.provider;
  }
  if (input.responseMode !== undefined) {
    if (!isBotResponseMode(input.responseMode)) {
      throw new BotSettingsValidationError("Недопустимый режим ответа");
    }
    data.responseMode = input.responseMode;
  }
  if (input.channels !== undefined) {
    data.channels = {
      siteWidget: Boolean(input.channels.siteWidget),
      vk: Boolean(input.channels.vk),
      max: Boolean(input.channels.max),
      telegram: Boolean(input.channels.telegram),
    };
  }
  if (input.mainInstruction !== undefined) {
    data.mainInstruction = normalizeOptionalText(input.mainInstruction);
  }
  if (input.knowledgeBaseNote !== undefined) {
    data.knowledgeBaseNote = normalizeOptionalText(input.knowledgeBaseNote);
  }
  if (input.handoffRules !== undefined) {
    data.handoffRules = normalizeOptionalText(input.handoffRules);
  }
  if (input.taggingRules !== undefined) {
    data.taggingRules = normalizeOptionalText(input.taggingRules);
  }
  if (input.safetyRules !== undefined) {
    data.safetyRules = normalizeOptionalText(input.safetyRules);
  }
  if (input.maxMessagesPerClient !== undefined) {
    data.maxMessagesPerClient = validatePositiveInt(
      input.maxMessagesPerClient,
      "Лимит сообщений на клиента",
    );
  }
  if (input.maxDailyMessages !== undefined) {
    data.maxDailyMessages = validatePositiveInt(
      input.maxDailyMessages,
      "Дневной лимит сообщений",
    );
  }
  if (input.logRetentionDays !== undefined) {
    data.logRetentionDays = validatePositiveInt(
      input.logRetentionDays,
      "Срок хранения обычных событий",
    );
  }
  if (input.errorLogRetentionDays !== undefined) {
    data.errorLogRetentionDays = validatePositiveInt(
      input.errorLogRetentionDays,
      "Срок хранения ошибок",
    );
  }
  if (input.maxStoredBotEvents !== undefined) {
    data.maxStoredBotEvents = validatePositiveInt(
      input.maxStoredBotEvents,
      "Максимум хранимых событий",
    );
  }

  const row = await prisma.botSettings.update({
    where: { id: BOT_SETTINGS_ID },
    data,
    select: botSettingsSelect,
  });

  return mapSettings(row);
}

export async function resetBotSettings(
  updatedByUserId: string,
): Promise<BotSettingsDto> {
  await ensureBotSettings();

  const row = await prisma.botSettings.update({
    where: { id: BOT_SETTINGS_ID },
    data: {
      ...buildDefaultUpdateData(),
      updatedByUser: { connect: { id: updatedByUserId } },
    },
    select: botSettingsSelect,
  });

  return mapSettings(row);
}