/**
 * BOT-CONTROL-PLANE-02 — static security/regression checks for bot settings publications.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testSchemaAndMigration(): void {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model BotSettingsPublication/);
  assert.match(schema, /activePublicationId/);
  assert.match(schema, /enum BotSettingsPublicationStatus/);
  assert.match(schema, /ACTIVE/);
  assert.match(schema, /SUPERSEDED/);

  const migration = read(
    "prisma/migrations/20260828210000_bot_settings_publications/migration.sql",
  );
  assert.match(migration, /bot_settings_publications_one_active_per_settings/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
  assert.doesNotMatch(migration, /DROP TABLE "bot_settings"/);
}

function testServiceSemantics(): void {
  const service = read("src/services/BotSettingsPublicationService.ts");
  assert.match(service, /publishCurrentBotSettings/);
  assert.match(service, /activateBotSettingsPublication/);
  assert.match(service, /getActiveBotSettingsRuntimePublication/);
  assert.match(service, /outcome: "UNCHANGED"/);
  assert.match(service, /BotSettingsPublicationStatus\.ACTIVE/);
  assert.match(service, /BotSettingsPublicationStatus\.SUPERSEDED/);
  assert.match(service, /getActiveBotSettingsRuntimePublication/);
  assert.match(service, /botSettingsPublication\.findFirst/);
  assert.doesNotMatch(service, /prisma\.botSettings\.update\([\s\S]*mainInstruction/);
}

function testPayloadContract(): void {
  const contract = read("src/lib/bot-settings/publication-contract.ts");
  assert.match(contract, /emergencyLockOwnedByBotCoreEnv: true/);
  assert.match(contract, /effectiveRuntimeModeOwnedByBotCoreEnv: true/);
  assert.match(contract, /desiredAdminState/);
  assert.match(contract, /BOT_SETTINGS_NOT_PUBLISHED/);

  const payload = read("src/lib/bot-settings/publication-payload.ts");
  assert.match(payload, /stableStringify/);
  assert.match(payload, /hashBotSettingsPublicationPayload/);
  assert.doesNotMatch(payload, /apiKey|password|secret/i);
}

function testAdminRoutes(): void {
  const publish = read("src/app/api/admin/bot/settings/publish/route.ts");
  assert.match(publish, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(publish, /publishCurrentBotSettings/);
  assert.doesNotMatch(publish, /updateBotSettings/);

  const patch = read("src/app/api/admin/bot/settings/route.ts");
  assert.match(patch, /updateBotSettings/);
  assert.doesNotMatch(patch, /publishCurrentBotSettings/);

  const activate = read(
    "src/app/api/admin/bot/settings/publications/[id]/activate/route.ts",
  );
  assert.match(activate, /activateBotSettingsPublication/);
}

function testInternalRuntimeRoute(): void {
  const route = read("src/app/api/internal/bot/v1/settings/route.ts");
  assert.match(route, /withBotInternalApi/);
  assert.match(route, /getActiveBotSettingsRuntimePublication/);
  assert.match(route, /BOT_SETTINGS_NOT_PUBLISHED/);
  assert.match(route, /status: 404/);
  assert.doesNotMatch(route, /getBotSettings/);
  assert.doesNotMatch(route, /DEFAULT_BOT_SETTINGS/);
  assert.doesNotMatch(route, /findUnique\(\{[\s\S]*botSettings/);
}

function testAdminUi(): void {
  const panel = read("src/components/admin/bot-settings-panel.tsx");
  assert.match(panel, /Публикация настроек/);
  assert.match(panel, /\/api\/admin\/bot\/settings\/publish/);
  assert.match(panel, /hasUnpublishedChanges/);
  assert.match(panel, /Опубликовать/);
  assert.match(panel, /Активировать/);
}

function testPackageScripts(): void {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:security:bot-settings-publication"]);
  assert.ok(pkg.scripts["test:security:bot-settings-publication-db"]);
}

async function testPayloadChecksumDeterministic(): Promise<void> {
  const payloadModule = await import("../src/lib/bot-settings/publication-payload");
  const a = payloadModule.buildBotSettingsPublicationPayloadFromDraft({
    id: "default",
    isEnabled: false,
    mode: "OFF",
    provider: "NONE",
    responseMode: "DRAFT",
    channels: { siteWidget: false, vk: false, max: false, telegram: false, whatsapp: false },
    mainInstruction: "a",
    knowledgeBaseNote: null,
    handoffRules: null,
    taggingRules: null,
    safetyRules: null,
    maxMessagesPerClient: 20,
    maxDailyMessages: 200,
    logRetentionDays: 30,
    errorLogRetentionDays: 90,
    maxStoredBotEvents: 5000,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const b = { ...a, contentPolicy: { ...a.contentPolicy, mainInstruction: "b" } };
  const checksumA = payloadModule.hashBotSettingsPublicationPayload(a);
  const checksumB = payloadModule.hashBotSettingsPublicationPayload(b);
  assert.notEqual(checksumA, checksumB);
  assert.equal(checksumA, payloadModule.hashBotSettingsPublicationPayload(a));
}

async function main(): Promise<void> {
  testSchemaAndMigration();
  testServiceSemantics();
  testPayloadContract();
  testAdminRoutes();
  testInternalRuntimeRoute();
  testAdminUi();
  testPackageScripts();
  await testPayloadChecksumDeterministic();
  console.log("security-bot-settings-publication-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
