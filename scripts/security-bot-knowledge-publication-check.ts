/**
 * BOT-CONTROL-PLANE-03B — static security/regression checks for managed KB.
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
  assert.match(schema, /model BotKnowledgeEntry/);
  assert.match(schema, /model BotKnowledgePublication/);
  assert.match(schema, /model BotKnowledgeWorkspace/);
  assert.match(schema, /enum BotKnowledgeCategory/);
  assert.match(schema, /PROCEDURE_EXPLANATION/);
  assert.match(schema, /ESCALATION_GUIDANCE/);
  assert.doesNotMatch(schema, /SALES_GUIDANCE/);
  assert.doesNotMatch(schema, /TONE_EXAMPLE/);
  assert.doesNotMatch(schema, /enum BotKnowledgeCategory[\s\S]*OTHER/);

  const migration = read(
    "prisma/migrations/20260829180000_bot_knowledge_publications/migration.sql",
  );
  assert.match(migration, /bot_knowledge_publications_one_active_per_workspace/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
  assert.doesNotMatch(migration, /INSERT INTO "bot_knowledge_entries"/);
  assert.doesNotMatch(migration, /INSERT INTO "bot_knowledge_publications"/);
  assert.doesNotMatch(migration, /DROP TABLE "bot_settings"/);
  assert.doesNotMatch(migration, /DROP TABLE "services"/);
}

function testServiceSemantics(): void {
  const publication = read("src/services/BotKnowledgePublicationService.ts");
  assert.match(publication, /publishCurrentKnowledge/);
  assert.match(publication, /activateKnowledgePublication/);
  assert.match(publication, /getActiveBotKnowledgeRuntimePublication/);
  assert.match(publication, /outcome: "UNCHANGED"/);
  assert.match(publication, /FOR UPDATE/);
  assert.match(publication, /ensureWorkspaceLocked/);
  assert.doesNotMatch(publication, /publishCurrentBotSettings/);

  const entries = read("src/services/BotKnowledgeEntryService.ts");
  assert.match(entries, /createBotKnowledgeEntry/);
  assert.match(entries, /updateBotKnowledgeEntry/);
  assert.match(entries, /stableKey нельзя менять/);
  assert.doesNotMatch(entries, /publishCurrentKnowledge/);

  const foundation = read("src/services/BotKnowledgeFoundationService.ts");
  assert.match(foundation, /buildBotKnowledgeFoundationSummary/);
  assert.doesNotMatch(foundation, /botKnowledgeEntry/);
  assert.doesNotMatch(foundation, /BotKnowledgePublication/);
}

function testPayloadContract(): void {
  const contract = read("src/lib/bot-knowledge/publication-contract.ts");
  assert.match(contract, /BOT_KNOWLEDGE_NOT_PUBLISHED/);
  assert.match(contract, /BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS/);
  for (const field of [
    "price",
    "priceFrom",
    "duration",
    "slots",
    "availability",
    "promotions",
    "gifts",
  ]) {
    assert.match(contract, new RegExp(`"${field}"`));
  }

  const payload = read("src/lib/bot-knowledge/publication-payload.ts");
  assert.match(payload, /stableStringify/);
  assert.match(payload, /hashBotKnowledgePublicationPayload/);
  assert.match(payload, /assertExactKeys/);
  assert.match(payload, /OBVIOUS_PRICE_COPY_RE/);
  assert.doesNotMatch(payload, /apiKey|password|secret/i);
  assert.doesNotMatch(payload, /priceFrom|durationMinutes/);
}

function testAdminRoutes(): void {
  const create = read("src/app/api/admin/bot/knowledge/entries/route.ts");
  assert.match(create, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(create, /BOT_SETTINGS_VIEW_ROLES/);
  assert.match(create, /createBotKnowledgeEntry/);
  assert.doesNotMatch(create, /publishCurrentKnowledge/);
  assert.doesNotMatch(create, /MANAGER/);

  const patch = read("src/app/api/admin/bot/knowledge/entries/[id]/route.ts");
  assert.match(patch, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(patch, /updateBotKnowledgeEntry/);
  assert.doesNotMatch(patch, /publishCurrentKnowledge/);

  const publish = read("src/app/api/admin/bot/knowledge/publish/route.ts");
  assert.match(publish, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(publish, /publishCurrentKnowledge/);
  assert.doesNotMatch(publish, /publishCurrentBotSettings/);
  assert.doesNotMatch(publish, /MANAGER/);

  const activate = read(
    "src/app/api/admin/bot/knowledge/publications/[id]/activate/route.ts",
  );
  assert.match(activate, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(activate, /activateKnowledgePublication/);

  const settingsPublish = read("src/app/api/admin/bot/settings/publish/route.ts");
  assert.doesNotMatch(settingsPublish, /publishCurrentKnowledge/);

  const apiAccess = read("src/lib/auth/api-access.ts");
  assert.match(apiAccess, /BOT_SETTINGS_VIEW_ROLES[\s\S]*OWNER_ROLES/);
  assert.match(apiAccess, /BOT_SETTINGS_EDIT_ROLES[\s\S]*OWNER_ROLES/);
}

function testInternalRuntimeRoute(): void {
  const route = read("src/app/api/internal/bot/v1/knowledge/route.ts");
  assert.match(route, /withBotInternalApi/);
  assert.match(route, /getActiveBotKnowledgeRuntimePublication/);
  assert.match(route, /BOT_KNOWLEDGE_NOT_PUBLISHED/);
  assert.match(route, /status: 404/);
  assert.match(route, /BOT_KNOWLEDGE_PUBLICATION_INVALID/);
  assert.match(route, /status: 409/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /listBotKnowledgeEntries/);
  assert.doesNotMatch(route, /botKnowledgeEntry/);
  assert.doesNotMatch(route, /prisma\.botKnowledgeEntry/);

  const runtimeService = read("src/services/BotKnowledgePublicationService.ts");
  const runtimeFn = runtimeService.match(
    /export async function getActiveBotKnowledgeRuntimePublication[\s\S]*?^export type/m,
  );
  assert.ok(runtimeFn, "runtime loader function must exist");
  assert.doesNotMatch(runtimeFn[0], /botKnowledgeEntry/);
  assert.doesNotMatch(runtimeFn[0], /prisma\.botKnowledgeEntry/);
  assert.match(runtimeFn[0], /if \(!row\) \{\s*return null;/);
}

function testAdminUi(): void {
  const panel = read("src/components/admin/bot-knowledge-panel.tsx");
  assert.match(panel, /База знаний Теи/);
  assert.match(panel, /\/api\/admin\/bot\/knowledge\/publish/);
  assert.match(panel, /hasUnpublishedChanges/);
  assert.match(panel, /Опубликовать KB/);
  assert.match(panel, /Активировать/);
  assert.match(panel, /Save ≠ Publish/);

  const page = read("src/app/admin/bot/page.tsx");
  assert.match(page, /BotKnowledgePanel/);
  assert.match(page, /buildBotKnowledgeFoundationSummary/);
}

function testPackageScripts(): void {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:security:bot-knowledge-publication"]);
  assert.ok(pkg.scripts["test:security:bot-knowledge-publication-db"]);
  assert.ok(pkg.scripts["test:security:bot-knowledge-publication-db:required"]);
}

function testCiWorkflow(): void {
  const workflow = read(".github/workflows/bot-internal-booking-create-pg-gate.yml");
  assert.match(workflow, /test:security:bot-knowledge-publication/);
  assert.match(workflow, /test:security:bot-knowledge-publication-db:required/);
  assert.match(workflow, /BotKnowledgePublicationService\.ts/);
  assert.match(workflow, /src\/lib\/bot-knowledge\/publication-/);
  assert.doesNotMatch(workflow, /bot-knowledge-publication-db-check[\s\S]*SKIPPED/);
}

async function testStrictPayloadValidation(): Promise<void> {
  const {
    assertValidBotKnowledgePublicationPayload,
    BotKnowledgePublicationPayloadError,
    buildBotKnowledgePublicationPayloadFromEntries,
    hashBotKnowledgePublicationPayload,
  } = await import("../src/lib/bot-knowledge/publication-payload");
  const { BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS } = await import(
    "../src/lib/bot-knowledge/publication-contract"
  );

  const valid = buildBotKnowledgePublicationPayloadFromEntries([
    {
      stableKey: "faq-laser-prep",
      category: "PREPARATION",
      title: "Подготовка к процедуре",
      content: "Приходите без макияжа.",
      tags: ["laser"],
      serviceId: null,
      isEnabled: true,
    },
    {
      stableKey: "faq-general",
      category: "FAQ",
      title: "Общий вопрос",
      content: "Ответ без цен.",
      tags: [],
      serviceId: null,
      isEnabled: true,
    },
    {
      stableKey: "disabled-skip",
      category: "FAQ",
      title: "Скрытая",
      content: "Не должна попасть",
      tags: [],
      serviceId: null,
      isEnabled: false,
    },
  ]);

  assert.equal(valid.entries.length, 2);
  assert.equal(valid.entries[0].key, "faq-general");
  assert.equal(valid.entries[1].key, "faq-laser-prep");
  assertValidBotKnowledgePublicationPayload(valid);

  const shuffled = {
    schemaVersion: 1 as const,
    entries: [valid.entries[1], valid.entries[0]],
  };
  assert.throws(
    () => assertValidBotKnowledgePublicationPayload(shuffled),
    (error: unknown) => error instanceof BotKnowledgePublicationPayloadError,
  );

  assert.throws(
    () =>
      buildBotKnowledgePublicationPayloadFromEntries([
        {
          stableKey: "bad-price",
          category: "FAQ",
          title: "Цена",
          content: "Стоимость 1500 ₽",
          tags: [],
          serviceId: null,
          isEnabled: true,
        },
      ]),
    (error: unknown) => error instanceof BotKnowledgePublicationPayloadError,
  );

  const malformedCases: unknown[] = [
    { ...valid, schemaVersion: 2 },
    { ...valid, unexpectedKey: true },
    {
      ...valid,
      entries: [{ ...valid.entries[0], category: "SALES_GUIDANCE" }],
    },
    {
      ...valid,
      entries: [{ ...valid.entries[0], price: 100 }],
    },
    {
      schemaVersion: 1,
      entries: [{ ...valid.entries[0], extra: true }],
    },
  ];

  for (const malformed of malformedCases) {
    assert.throws(
      () => assertValidBotKnowledgePublicationPayload(malformed),
      (error: unknown) => error instanceof BotKnowledgePublicationPayloadError,
    );
  }

  for (const field of BOT_KNOWLEDGE_FORBIDDEN_LIVE_FACT_FIELDS) {
    assert.throws(
      () =>
        assertValidBotKnowledgePublicationPayload({
          schemaVersion: 1,
          entries: [],
          [field]: "x",
        }),
      (error: unknown) => error instanceof BotKnowledgePublicationPayloadError,
    );
  }

  const checksumA = hashBotKnowledgePublicationPayload(valid);
  const checksumB = hashBotKnowledgePublicationPayload(valid);
  assert.equal(checksumA, checksumB);

  const reorderedInput = buildBotKnowledgePublicationPayloadFromEntries([
    {
      stableKey: "faq-laser-prep",
      category: "PREPARATION",
      title: "Подготовка к процедуре",
      content: "Приходите без макияжа.",
      tags: ["laser"],
      serviceId: null,
      isEnabled: true,
    },
    {
      stableKey: "faq-general",
      category: "FAQ",
      title: "Общий вопрос",
      content: "Ответ без цен.",
      tags: [],
      serviceId: null,
      isEnabled: true,
    },
  ]);
  assert.equal(hashBotKnowledgePublicationPayload(reorderedInput), checksumA);
}

async function main(): Promise<void> {
  testSchemaAndMigration();
  testServiceSemantics();
  testPayloadContract();
  testAdminRoutes();
  testInternalRuntimeRoute();
  testAdminUi();
  testPackageScripts();
  testCiWorkflow();
  await testStrictPayloadValidation();
  console.log("security-bot-knowledge-publication-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
