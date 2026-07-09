import type {
  BotChannels,
  BotMode,
  BotProvider,
  BotResponseMode,
} from "@/lib/bot-settings/defaults";

export type BotSettingsDto = {
  id: string;
  isEnabled: boolean;
  mode: BotMode;
  provider: BotProvider;
  responseMode: BotResponseMode;
  channels: BotChannels;
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
  updatedByUserId: string | null;
  updatedByUserName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotSettingsWriteInput = {
  isEnabled?: boolean;
  mode?: BotMode;
  provider?: BotProvider;
  responseMode?: BotResponseMode;
  channels?: BotChannels;
  mainInstruction?: string | null;
  knowledgeBaseNote?: string | null;
  handoffRules?: string | null;
  taggingRules?: string | null;
  safetyRules?: string | null;
  maxMessagesPerClient?: number;
  maxDailyMessages?: number;
  logRetentionDays?: number;
  errorLogRetentionDays?: number;
  maxStoredBotEvents?: number;
};
