import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BOT_SETTINGS_ID,
  DEFAULT_BOT_CHANNELS,
  DEFAULT_BOT_SETTINGS,
  isBotMode,
  isBotProvider,
  isBotResponseMode,
  normalizeBotMode,
  normalizeBotProvider,
  normalizeBotResponseMode,
  resolveBotModeInput,
  resolveBotProviderInput,
  resolveBotResponseModeInput,
  responseModeForBotMode,
  type BotChannels,
  type BotMode,
  type BotProvider,
  type BotResponseMode,
} from "@/lib/bot-settings/defaults";
import { evaluateFoundationBotReadiness } from "@/lib/bot-settings/readiness";
import type {
  BotSettingsDto,
  BotSettingsWriteInput,
} from "@/types/bot-settings";

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
    whatsapp: Boolean(record.whatsapp),
  };
}

function mapSettings(row: BotSettingsRow): BotSettingsDto {
  const mode = normalizeBotMode(row.mode);
  const provider = normalizeBotProvider(row.provider);
  const responseMode = normalizeBotResponseMode(row.responseMode);
  const channels = parseChannels(row.channels);
  const readiness = evaluateFoundationBotReadiness({
    mode,
    isEnabled: row.isEnabled,
    provider,
    channels,
  });

  return {
    id: row.id,
    isEnabled: row.isEnabled,
    mode,
    provider,
    responseMode,
    channels,
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
    readiness,
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

function assertAutoAllowed(mode: BotMode, provider: BotProvider, channels: BotChannels, isEnabled: boolean) {
  if (mode !== "AUTO") {
    return;
  }

  const readiness = evaluateFoundationBotReadiness({
    mode,
    isEnabled,
    provider,
    channels,
  });

  if (!readiness.canEnableAuto) {
    throw new BotSettingsValidationError(
      "Режим «Автоответ клиенту» нельзя включить: не пройдены readiness checks. Бот пока не подключён к AI, каналам и runtime-защите.",
    );
  }
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
  const current = await ensureBotSettings();
  const currentMapped = mapSettings(current);

  let nextMode: BotMode = currentMapped.mode;
  let nextProvider: BotProvider = currentMapped.provider;
  let nextChannels: BotChannels = currentMapped.channels;
  let nextIsEnabled = currentMapped.isEnabled;
  let nextResponseMode: BotResponseMode = currentMapped.responseMode;

  const data: Prisma.BotSettingsUpdateInput = {
    updatedByUser: { connect: { id: updatedByUserId } },
  };

  if (input.mode !== undefined) {
    if (!isBotMode(input.mode)) {
      throw new BotSettingsValidationError("Недопустимый режим бота");
    }
    nextMode = resolveBotModeInput(input.mode);
    data.mode = nextMode;
    nextResponseMode = responseModeForBotMode(nextMode);
    data.responseMode = nextResponseMode;
    if (nextMode === "OFF") {
      nextIsEnabled = false;
      data.isEnabled = false;
    }
  }

  if (input.responseMode !== undefined) {
    if (!isBotResponseMode(input.responseMode)) {
      throw new BotSettingsValidationError("Недопустимый режим ответа");
    }
    // Explicit responseMode only applies when mode is not being driven as primary;
    // if mode was also sent, mode wins via sync above.
    if (input.mode === undefined) {
      nextResponseMode = resolveBotResponseModeInput(input.responseMode);
      data.responseMode = nextResponseMode;
      if (nextResponseMode === "AUTO") {
        nextMode = "AUTO";
        data.mode = "AUTO";
      } else if (nextResponseMode === "HINTS" && nextMode === "OFF") {
        // keep OFF; storing HINTS as aspirational response mirror is ok
      } else if (nextResponseMode === "HINTS" || nextResponseMode === "DRAFT") {
        if (nextMode === "AUTO") {
          nextMode = nextResponseMode === "HINTS" ? "HINTS" : "DRAFT";
          data.mode = nextMode;
        }
      }
    }
  }

  if (input.provider !== undefined) {
    if (!isBotProvider(input.provider)) {
      throw new BotSettingsValidationError("Недопустимый провайдер");
    }
    nextProvider = resolveBotProviderInput(input.provider);
    data.provider = nextProvider;
  }

  if (input.channels !== undefined) {
    nextChannels = {
      siteWidget: Boolean(input.channels.siteWidget),
      vk: Boolean(input.channels.vk),
      max: Boolean(input.channels.max),
      telegram: Boolean(input.channels.telegram),
      whatsapp: Boolean(input.channels.whatsapp),
    };
    data.channels = nextChannels;
  }

  if (input.isEnabled !== undefined) {
    nextIsEnabled = nextMode === "OFF" ? false : Boolean(input.isEnabled);
    data.isEnabled = nextIsEnabled;
  }

  assertAutoAllowed(nextMode, nextProvider, nextChannels, nextIsEnabled);

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
