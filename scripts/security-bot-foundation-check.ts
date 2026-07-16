/**
 * Security / regression checks for admin bot foundation control plane:
 * Bot Core boundary, phased plan, readiness groups, knowledge sources,
 * channels vs amoCRM, WhatsApp future enum, Yandex target, AUTO blocked.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BOT_CAN_DO,
  BOT_FOUNDATION_CAPABILITIES,
  BOT_MODE_LABELS,
  BOT_MUST_HANDOFF,
  BOT_PROVIDER_LABELS,
  BOT_RESPONSE_MODE_LABELS,
  DEFAULT_BOT_SETTINGS,
  normalizeBotMode,
  normalizeBotProvider,
  normalizeBotResponseMode,
  responseModeForBotMode,
} from "../src/lib/bot-settings/defaults";
import {
  BOT_CONNECTION_PHASES,
  BOT_CONTROL_PLANE_ROLE,
  BOT_CORE_BOUNDARY_FORBIDDEN,
  BOT_CURRENT_PROJECT_PHASE,
  BOT_FSM_PIPELINE,
} from "../src/lib/bot-settings/architecture";
import {
  BOT_CAMPAIGN_ENGINE_GAPS,
  BOT_DISCOUNT_CALCULATION_POLICY,
  BOT_GAME_FLOW_POLICY,
  BOT_RESCHEDULE_OWNERSHIP_GAP,
  BOT_SLOT_STRATEGY_GAPS,
} from "../src/lib/bot-settings/campaign-engine";
import {
  evaluateBotReadiness,
  evaluateFoundationBotReadiness,
  BOT_READINESS_GROUP_LABELS,
} from "../src/lib/bot-settings/readiness";
import {
  BOT_CRM_INTEGRATIONS,
  BOT_MESSAGING_CHANNELS,
} from "../src/lib/bot-settings/integrations";
import {
  BOT_TARGET_AI_PROVIDER,
  getBotAiProviderFoundationStatus,
} from "../src/lib/bot-settings/provider-plan";
import {
  BOT_PII_BOUNDARIES,
  BOT_TONE_OF_VOICE,
} from "../src/lib/bot-settings/tone-of-voice";
import { BOT_KNOWLEDGE_SOURCES } from "../src/lib/bot-knowledge/types";
import { PROMO_RULES } from "../src/lib/promo/promo-engine";
import {
  canAccessAdminPath,
  canAccessAdminSection,
} from "../src/lib/auth/permissions";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertModesAndLegacy(): void {
  assert.deepEqual(Object.keys(BOT_MODE_LABELS).sort(), [
    "AUTO",
    "DRAFT",
    "HINTS",
    "OFF",
    "TEST",
  ]);
  assert.equal(normalizeBotMode("ENABLED_LATER"), "DRAFT");
  assert.equal(normalizeBotResponseMode("HINTS_ONLY"), "HINTS");
  assert.equal(normalizeBotResponseMode("AUTO_LATER"), "AUTO");
  assert.equal(normalizeBotProvider("unknown"), "NONE");
  assert.equal(responseModeForBotMode("AUTO"), "AUTO");
  assert.equal(DEFAULT_BOT_SETTINGS.mode, "OFF");
  assert.equal(DEFAULT_BOT_SETTINGS.isEnabled, false);
  assert.equal(DEFAULT_BOT_SETTINGS.provider, "NONE");
  assert.equal(DEFAULT_BOT_SETTINGS.channels.whatsapp, false);

  const defaultsSource = read("src/lib/bot-settings/defaults.ts");
  assert.doesNotMatch(
    defaultsSource
      .replace(/export const BOT_RESPONSE_MODE_LEGACY_ALIASES[\s\S]*?\};/, "")
      .replace(/export const BOT_MODE_LEGACY_ALIASES[\s\S]*?\};/, ""),
    /AUTO_LATER|HINTS_ONLY|ENABLED_LATER/,
  );
  assert.doesNotMatch(
    Object.values(BOT_MODE_LABELS).join("\n"),
    /AUTO_LATER|ENABLED_LATER|HINTS_ONLY/,
  );
  assert.doesNotMatch(
    Object.values(BOT_RESPONSE_MODE_LABELS).join("\n"),
    /AUTO_LATER|HINTS_ONLY/,
  );
}

function assertBotCoreBoundary(): void {
  assert.equal(BOT_CURRENT_PROJECT_PHASE.botCoreDeployed, false);
  assert.ok(BOT_CONTROL_PLANE_ROLE.some((line) => /control plane/i.test(line)));
  assert.ok(
    BOT_CORE_BOUNDARY_FORBIDDEN.some((line) => /PostgreSQL|Prisma/i.test(line)),
  );
  assert.match(BOT_FSM_PIPELINE, /КЛАССИФИКАЦИЯ/);

  const panel = read("src/components/admin/bot-settings-panel.tsx");
  assert.match(panel, /Control plane/);
  assert.match(panel, /Bot Core не развёрнут/);
  assert.doesNotMatch(panel, /openai\.chat|fetch\(["']https:\/\/api\.openai/i);

  const knowledge = stripComments(
    read("src/services/BotKnowledgeFoundationService.ts"),
  );
  assert.match(knowledge, /server-only/);
  assert.doesNotMatch(knowledge, /openai|yandexcloud|fetch\(/i);

  const archDoc = read("docs/architecture/bot-control-plane-foundation.md");
  assert.match(archDoc, /отдельный runtime/i);
  assert.match(archDoc, /PostgreSQL/);
  assert.match(archDoc, /amoCRM/);
}

function assertPhasedPlan(): void {
  assert.deepEqual(
    BOT_CONNECTION_PHASES.map((p) => p.id),
    [
      "internal_api",
      "amocrm",
      "vk",
      "max",
      "site",
      "telegram",
      "whatsapp",
    ],
  );
  assert.equal(BOT_CONNECTION_PHASES[0]?.phase, 0);
  assert.equal(BOT_CONNECTION_PHASES[1]?.id, "amocrm");
  assert.equal(BOT_CONNECTION_PHASES[2]?.id, "vk");
  assert.equal(BOT_CONNECTION_PHASES[6]?.id, "whatsapp");

  const whatsapp = BOT_MESSAGING_CHANNELS.find((c) => c.id === "whatsapp");
  assert.ok(whatsapp);
  assert.equal(whatsapp?.status, "deferred");
  assert.equal(whatsapp?.runtime, false);
  assert.equal(whatsapp?.phase, 6);

  const panel = read("src/components/admin/bot-settings-panel.tsx");
  assert.match(panel, /Этап 0|Внутренние API|amoCRM/);
  assert.doesNotMatch(
    panel,
    /сайт, VK и MAX одновременно стартов|стартовые каналы: сайт/i,
  );

  const integrations = read("src/lib/bot-settings/integrations.ts");
  assert.match(integrations, /platform-api2\.max\.ru/);
  assert.match(integrations, /whatsapp/);
  assert.match(integrations, /status:\s*"deferred"/);
}

function assertChannelsVsCrm(): void {
  assert.ok(BOT_CRM_INTEGRATIONS.every((i) => i.role === "crm_integration"));
  assert.ok(
    BOT_MESSAGING_CHANNELS.every((i) => i.role === "messaging_channel"),
  );
  const amo = BOT_CRM_INTEGRATIONS.find((i) => i.id === "amocrm");
  assert.ok(amo);
  assert.equal(amo?.phase, 1);
  assert.ok(amo?.readinessItems.some((i) => i.id === "oauth_readiness"));
  assert.ok(amo?.botMustNot.some((i) => /закрывать сделки/i.test(i)));

  const panel = read("src/components/admin/bot-settings-panel.tsx");
  assert.match(panel, /CRM integration/);
  assert.doesNotMatch(panel, /AUTO_LATER|HINTS_ONLY|ENABLED_LATER/);

  const integrations = read("src/lib/bot-settings/integrations.ts");
  assert.match(integrations, /Token health/);
  assert.match(integrations, /oauth_readiness/);
}

function assertProviderPlan(): void {
  assert.equal(BOT_TARGET_AI_PROVIDER.id, "YANDEX_CLOUD_AI_STUDIO");
  const status = getBotAiProviderFoundationStatus();
  assert.equal(status.defaultProviderSetting, "NONE");
  assert.equal(status.classifier.status, "not_configured");
  assert.equal(status.dialogue.status, "not_configured");
  assert.equal(status.serverCredentials, "absent");
  assert.equal(status.providerHealth, "not_checked");
  assert.match(BOT_PROVIDER_LABELS.YANDEX, /Yandex Cloud/i);
  assert.match(BOT_PROVIDER_LABELS.OPENAI, /резерв/i);
}

function assertReadinessBlocksAuto(): void {
  const foundation = evaluateFoundationBotReadiness({
    mode: "AUTO",
    isEnabled: true,
    provider: "YANDEX",
    channels: {
      siteWidget: true,
      vk: true,
      max: true,
      telegram: true,
      whatsapp: true,
    },
  });
  assert.equal(foundation.allReady, false);
  assert.equal(foundation.canEnableAuto, false);
  assert.ok(foundation.checks.length >= 30);
  assert.ok(foundation.checks.every((check) => check.ready === false));
  assert.deepEqual(
    foundation.groups.map((g) => g.id).sort(),
    Object.keys(BOT_READINESS_GROUP_LABELS).sort(),
  );
  assert.ok(foundation.checks.some((c) => c.id === "temporary_hold_api"));
  assert.ok(foundation.checks.some((c) => c.id === "tone_post_filter"));
  assert.ok(foundation.checks.some((c) => c.id === "amocrm_oauth"));
  assert.ok(foundation.checks.some((c) => c.id === "bot_core_endpoint"));

  const fakeReady = evaluateBotReadiness({
    mode: "AUTO",
    isEnabled: true,
    provider: "YANDEX",
    channels: {
      siteWidget: false,
      vk: true,
      max: false,
      telegram: false,
      whatsapp: false,
    },
    hasBotCoreEndpoint: true,
    hasBotCoreHealth: true,
    hasServiceToServiceAuth: true,
    hasEventQueue: true,
    hasIdempotency: true,
    hasAuditTrail: true,
    hasYandexProvider: true,
    hasClassifierModel: true,
    hasDialogueModel: true,
    hasServerSideCredentials: true,
    hasStructuredOutput: true,
    hasToolCallAllowlist: true,
    hasTonePostFilter: true,
    hasPromptInjectionBoundary: true,
    hasLiveChannel: true,
    hasChannelWebhook: true,
    hasSignatureVerification: true,
    hasReplayProtection: true,
    hasRateLimitEnforcement: true,
    hasOutboundHealth: true,
    hasAmoCrmOAuth: true,
    hasAmoCrmRefreshLifecycle: true,
    hasAmoCrmWebhook: true,
    hasAmoCrmTasksTags: true,
    hasAmoCrmHandoffOwnership: true,
    hasCatalogApi: true,
    hasMastersApi: true,
    hasAvailabilityApi: true,
    hasRankedSlots: true,
    hasTemporaryHoldApi: true,
    hasFinalSlotRecheck: true,
    hasBookingValidation: true,
    hasLegalForm: true,
    hasAddressSourceComplete: true,
    hasPiiMinimization: true,
    hasLogRedaction: true,
    hasRetentionEnforcement: true,
    hasDeletionWorkflow: true,
    hasMonitoring: true,
    hasErrorHandling: true,
  });
  // tone post-filter also requires BOT_TONE_OF_VOICE.postFilterImplemented
  assert.equal(BOT_TONE_OF_VOICE.postFilterImplemented, false);
  assert.equal(fakeReady.canEnableAuto, false);
  assert.ok(
    fakeReady.checks.some((c) => c.id === "tone_post_filter" && !c.ready),
  );

  const service = read("src/services/BotSettingsService.ts");
  assert.match(service, /assertAutoAllowed|canEnableAuto/);
  assert.match(service, /нельзя включить/);
}

function assertKnowledgeAndGaps(): void {
  assert.ok(BOT_KNOWLEDGE_SOURCES.includes("services"));
  assert.ok(BOT_KNOWLEDGE_SOURCES.includes("game_play_snapshot"));
  assert.ok(BOT_KNOWLEDGE_SOURCES.includes("availability_service"));

  const knowledge = read("src/services/BotKnowledgeFoundationService.ts");
  assert.match(knowledge, /getBookingCatalog/);
  assert.match(knowledge, /temporaryHoldStatus:\s*"gap"/);
  assert.match(knowledge, /GamePlay\/GameSession snapshot/);
  assert.match(knowledge, /collectPhoneInChat:\s*false/);
  assert.match(knowledge, /Уход для рук/);

  assert.equal(BOT_DISCOUNT_CALCULATION_POLICY.engine, "promo-engine");
  assert.equal(
    BOT_DISCOUNT_CALCULATION_POLICY.secondDiscountEngineForbidden,
    true,
  );
  assert.ok(BOT_SLOT_STRATEGY_GAPS.some((g) => g.id === "temporary_hold_api"));
  assert.equal(BOT_RESCHEDULE_OWNERSHIP_GAP.status, "not_implemented");
  assert.ok(BOT_CAMPAIGN_ENGINE_GAPS.every((g) => g.status === "not_implemented"));
  assert.match(BOT_GAME_FLOW_POLICY.outdatedExampleNote, /Уход для рук/);
}

function assertHandoffCapabilitiesTone(): void {
  assert.ok(BOT_FOUNDATION_CAPABILITIES.some((i) => i.id === "slots"));
  assert.ok(BOT_CAN_DO.some((i) => /цен/i.test(i)));
  assert.ok(BOT_MUST_HANDOFF.some((i) => /медицин/i.test(i)));
  assert.doesNotMatch(
    DEFAULT_BOT_SETTINGS.handoffRules,
    /если клиент спрашивает цену,\s*противопоказания/i,
  );
  assert.equal(BOT_TONE_OF_VOICE.postFilterRequiredForAuto, true);
  assert.ok(BOT_TONE_OF_VOICE.bannedPhrases.includes("освежить лицо"));
  assert.ok(BOT_PII_BOUNDARIES.some((i) => /не просит телефон/i.test(i)));
}

function assertNoSecretsAndRoleAccess(): void {
  const dto = read("src/types/bot-settings.ts");
  assert.doesNotMatch(dto, /apiKey|accessToken|refreshToken|password/i);
  assert.equal(canAccessAdminSection("MANAGER", "bot"), false);
  assert.equal(canAccessAdminPath("MANAGER", "/admin/bot"), false);
  assert.equal(canAccessAdminSection("OWNER", "bot"), true);
}

function assertPromotionsGameUntouched(): void {
  assert.ok(PROMO_RULES.some((rule) => rule.id === "cold-plasma-first-visit-30"));
  const promoEngine = read("src/lib/promo/promo-engine.ts");
  assert.match(promoEngine, /cold-plasma-first-visit-30/);
  const knowledge = read("src/services/BotKnowledgeFoundationService.ts");
  assert.doesNotMatch(
    knowledge,
    /updateMany|createOnlineBooking|prisma\.\$executeRaw/,
  );
}

function main(): void {
  assertModesAndLegacy();
  assertBotCoreBoundary();
  assertPhasedPlan();
  assertChannelsVsCrm();
  assertProviderPlan();
  assertReadinessBlocksAuto();
  assertKnowledgeAndGaps();
  assertHandoffCapabilitiesTone();
  assertNoSecretsAndRoleAccess();
  assertPromotionsGameUntouched();
  console.log("security-bot-foundation-check: OK");
}

main();
