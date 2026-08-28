import type {
  BotChannels,
  BotMode,
  BotProvider,
  BotResponseMode,
} from "@/lib/bot-settings/defaults";

export const BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION = 1 as const;

/**
 * Immutable published snapshot contract for bot-TV S2S consumers.
 * `desiredAdminState` is owner intent only — not effective bot-TV runtime mode.
 * EMERGENCY_LOCK and effective BOT_MODE remain bot-TV env safety gates.
 */
export type BotSettingsPublicationPayloadV1 = {
  schemaVersion: typeof BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION;
  desiredAdminState: {
    isEnabled: boolean;
    mode: BotMode;
    responseMode: BotResponseMode;
  };
  provider: BotProvider;
  channels: BotChannels;
  contentPolicy: {
    mainInstruction: string | null;
    knowledgeBaseNote: string | null;
    handoffRules: string | null;
    taggingRules: string | null;
    safetyRules: string | null;
  };
  limits: {
    maxMessagesPerClient: number;
    maxDailyMessages: number;
    logRetentionDays: number;
    errorLogRetentionDays: number;
    maxStoredBotEvents: number;
  };
  operationalSafety: {
    emergencyLockOwnedByBotCoreEnv: true;
    effectiveRuntimeModeOwnedByBotCoreEnv: true;
  };
};

export const BOT_SETTINGS_NOT_PUBLISHED_CODE = "BOT_SETTINGS_NOT_PUBLISHED" as const;
