import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  BOT_SETTINGS_ID,
  BOT_MODE_LABELS,
  BOT_PROVIDER_LABELS,
  BOT_RESPONSE_MODE_LABELS,
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

export class BotSettingsPublicationPayloadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BotSettingsPublicationPayloadError";
  }
}

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "desiredAdminState",
  "provider",
  "channels",
  "contentPolicy",
  "limits",
  "operationalSafety",
] as const;

const DESIRED_ADMIN_STATE_KEYS = ["isEnabled", "mode", "responseMode"] as const;

const CHANNEL_KEYS = [
  "siteWidget",
  "vk",
  "max",
  "telegram",
  "whatsapp",
] as const;

const CONTENT_POLICY_KEYS = [
  "mainInstruction",
  "knowledgeBaseNote",
  "handoffRules",
  "taggingRules",
  "safetyRules",
] as const;

const LIMIT_KEYS = [
  "maxMessagesPerClient",
  "maxDailyMessages",
  "logRetentionDays",
  "errorLogRetentionDays",
  "maxStoredBotEvents",
] as const;

const OPERATIONAL_SAFETY_KEYS = [
  "emergencyLockOwnedByBotCoreEnv",
  "effectiveRuntimeModeOwnedByBotCoreEnv",
] as const;

const ALLOWED_BOT_MODES = new Set<string>(Object.keys(BOT_MODE_LABELS));
const ALLOWED_RESPONSE_MODES = new Set<string>(Object.keys(BOT_RESPONSE_MODE_LABELS));
const ALLOWED_PROVIDERS = new Set<string>(Object.keys(BOT_PROVIDER_LABELS));

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

function fail(code: string): never {
  throw new BotSettingsPublicationPayloadError(code);
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

function assertBoolean(value: unknown, code: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    fail(code);
  }
}

function assertNullableString(value: unknown, code: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    fail(code);
  }
}

function assertPositiveInt(value: unknown, code: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(code);
  }
}

function assertEnumValue(value: unknown, allowed: Set<string>, code: string): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail(code);
  }
}

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
  assertPlainObject(payload, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertExactKeys(payload, TOP_LEVEL_KEYS, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");

  if (payload.schemaVersion !== BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION) {
    fail("BOT_SETTINGS_PUBLICATION_SCHEMA_UNSUPPORTED");
  }

  assertPlainObject(payload.desiredAdminState, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertExactKeys(
    payload.desiredAdminState,
    DESIRED_ADMIN_STATE_KEYS,
    "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID",
  );
  assertBoolean(payload.desiredAdminState.isEnabled, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertEnumValue(
    payload.desiredAdminState.mode,
    ALLOWED_BOT_MODES,
    "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID",
  );
  assertEnumValue(
    payload.desiredAdminState.responseMode,
    ALLOWED_RESPONSE_MODES,
    "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID",
  );

  assertEnumValue(payload.provider, ALLOWED_PROVIDERS, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");

  assertPlainObject(payload.channels, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertExactKeys(payload.channels, CHANNEL_KEYS, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  for (const key of CHANNEL_KEYS) {
    assertBoolean(payload.channels[key], "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  assertPlainObject(payload.contentPolicy, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertExactKeys(
    payload.contentPolicy,
    CONTENT_POLICY_KEYS,
    "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID",
  );
  for (const key of CONTENT_POLICY_KEYS) {
    assertNullableString(payload.contentPolicy[key], "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  assertPlainObject(payload.limits, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  assertExactKeys(payload.limits, LIMIT_KEYS, "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  for (const key of LIMIT_KEYS) {
    assertPositiveInt(payload.limits[key], "BOT_SETTINGS_PUBLICATION_PAYLOAD_INVALID");
  }

  assertPlainObject(payload.operationalSafety, "BOT_SETTINGS_PUBLICATION_SAFETY_CONTRACT_INVALID");
  assertExactKeys(
    payload.operationalSafety,
    OPERATIONAL_SAFETY_KEYS,
    "BOT_SETTINGS_PUBLICATION_SAFETY_CONTRACT_INVALID",
  );
  if (payload.operationalSafety.emergencyLockOwnedByBotCoreEnv !== true) {
    fail("BOT_SETTINGS_PUBLICATION_SAFETY_CONTRACT_INVALID");
  }
  if (payload.operationalSafety.effectiveRuntimeModeOwnedByBotCoreEnv !== true) {
    fail("BOT_SETTINGS_PUBLICATION_SAFETY_CONTRACT_INVALID");
  }

  return {
    schemaVersion: BOT_SETTINGS_PUBLICATION_SCHEMA_VERSION,
    desiredAdminState: {
      isEnabled: payload.desiredAdminState.isEnabled as boolean,
      mode: payload.desiredAdminState.mode as BotMode,
      responseMode: payload.desiredAdminState.responseMode as BotResponseMode,
    },
    provider: payload.provider as BotProvider,
    channels: {
      siteWidget: payload.channels.siteWidget as boolean,
      vk: payload.channels.vk as boolean,
      max: payload.channels.max as boolean,
      telegram: payload.channels.telegram as boolean,
      whatsapp: payload.channels.whatsapp as boolean,
    },
    contentPolicy: {
      mainInstruction: payload.contentPolicy.mainInstruction as string | null,
      knowledgeBaseNote: payload.contentPolicy.knowledgeBaseNote as string | null,
      handoffRules: payload.contentPolicy.handoffRules as string | null,
      taggingRules: payload.contentPolicy.taggingRules as string | null,
      safetyRules: payload.contentPolicy.safetyRules as string | null,
    },
    limits: {
      maxMessagesPerClient: payload.limits.maxMessagesPerClient as number,
      maxDailyMessages: payload.limits.maxDailyMessages as number,
      logRetentionDays: payload.limits.logRetentionDays as number,
      errorLogRetentionDays: payload.limits.errorLogRetentionDays as number,
      maxStoredBotEvents: payload.limits.maxStoredBotEvents as number,
    },
    operationalSafety: {
      emergencyLockOwnedByBotCoreEnv: true,
      effectiveRuntimeModeOwnedByBotCoreEnv: true,
    },
  };
}
