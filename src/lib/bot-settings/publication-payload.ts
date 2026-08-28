import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  BOT_SETTINGS_ID,
  type BotChannels,
  type BotMode,
  type BotProvider,
  type BotResponseMode,
  normalizeBotMode,
  normalizeBotProvider,
  normalizeBotResponseMode,
} from "@/lib/bot-settings/defaults";
import {
  BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION,
  type BotSettingsPublicationPayloadV1,
} from "@/lib/bot-settings/publication-contract";

export { BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION };

type BotSettingsDraftRow = {
  id: string;
  isEnabled: boolean;
  mode: string;
  provider: string;
  responseMode: string;
  channels: Prisma.JsonValue;
  mainInstruction: string | null;
  knowledgeBaseNote: string | null;
  handoffRules: string | null;
  taggingRules: string | null;
  safetyRules: string | null;
  maxMessagesPerClient: number;
  maxDailyMessages: number;
  logRetentionDays: number;
  errorLogRetentionDays: number;
  maxStoredBotEvents: number;
  updatedAt: Date;
};

function parseChannels(value: Prisma.JsonValue): BotChannels {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      siteWidget: false,
      vk: false,
      max: false,
      telegram: false,
      whatsapp: false,
    };
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

export function hashBotSettingsPublicationPayload(
  payload: BotSettingsPublicationPayloadV1,
): string {
  return createHash("sha256")
    .update(stableStringify(payload), "utf8")
    .digest("hex");
}

export function buildBotSettingsPublicationPayloadFromDraft(
  row: BotSettingsDraftRow,
): BotSettingsPublicationPayloadV1 {
  if (row.id !== BOT_SETTINGS_ID) {
    throw new Error("BOT_SETTINGS_PUBLICATION_UNEXPECTED_SETTINGS_ID");
  }

  return {
    schemaVersion: BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION,
    desiredAdminState: {
      isEnabled: row.isEnabled,
      mode: normalizeBotMode(row.mode),
      responseMode: normalizeBotResponseMode(row.responseMode),
    },
    provider: normalizeBotProvider(row.provider),
    channels: parseChannels(row.channels),
    contentPolicy: {
      mainInstruction: row.mainInstruction,
      knowledgeBaseNote: row.knowledgeBaseNote,
      handoffRules: row.handoffRules,
      taggingRules: row.taggingRules,
      safetyRules: row.safetyRules,
    },
    limits: {
      maxMessagesPerClient: row.maxMessagesPerClient,
      maxDailyMessages: row.maxDailyMessages,
      logRetentionDays: row.logRetentionDays,
      errorLogRetentionDays: row.errorLogRetentionDays,
      maxStoredBotEvents: row.maxStoredBotEvents,
    },
    operationalSafety: {
      emergencyLockOwnedByBotCoreEnv: true,
      effectiveRuntimeModeOwnedByBotCoreEnv: true,
    },
  };
}

export function assertValidBotSettingsPublicationPayload(
  payload: unknown,
): BotSettingsPublicationPayloadV1 {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION) {
    throw new Error("BOT_SETTINGS_PUBLICATION_SCHEMA_UNSUPPORTED");
  }

  const desired = record.desiredAdminState;
  if (!desired || typeof desired !== "object" || Array.isArray(desired)) {
    throw new Error("BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  const limits = record.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new Error("BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  const operationalSafety = record.operationalSafety;
  if (
    !operationalSafety ||
    typeof operationalSafety !== "object" ||
    Array.isArray(operationalSafety)
  ) {
    throw new Error("BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  const safety = operationalSafety as Record<string, unknown>;
  if (
    safety.emergencyLockOwnedByBotCoreEnv !== true ||
    safety.effectiveRuntimeModeOwnedByBotCoreEnv !== true
  ) {
    throw new Error("BOT_SETTINGS_PUBLICATION_SAFETY_CONTRACT_INVALID");
  }

  return payload as BotSettingsPublicationPayloadV1;
}
