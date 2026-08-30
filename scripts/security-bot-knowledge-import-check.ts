/**
 * BOT-KB-IMPORT-01 — static + pure validation checks for managed KB draft import.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function testStaticSurface(): void {
  const service = read("src/services/BotKnowledgeEntryService.ts");
  assert.match(service, /export async function importBotKnowledgeEntries/);
  assert.match(service, /BOT_KNOWLEDGE_IMPORT_MAX_ENTRIES/);
  assert.match(service, /BOT_KNOWLEDGE_IMPORT_MAX_BYTES/);
  assert.match(service, /\$transaction/);
  assert.match(service, /Дубликат key в файле/);
  assert.match(service, /intentionally do not touch isEnabled/);
  assert.doesNotMatch(service, /publishCurrentKnowledge/);
  assert.doesNotMatch(service, /publishCurrentBotSettings/);

  const route = read(
    "src/app/api/admin/bot/knowledge/entries/import/route.ts",
  );
  assert.match(route, /requireProtectedMutatingApi/);
  assert.match(route, /BOT_SETTINGS_EDIT_ROLES/);
  assert.match(route, /importBotKnowledgeEntries/);
  assert.match(route, /BOT_KNOWLEDGE_IMPORT_MAX_BYTES/);
  assert.doesNotMatch(route, /MANAGER/);
  assert.doesNotMatch(route, /publishCurrentKnowledge/);

  const panel = read("src/components/admin/bot-knowledge-panel.tsx");
  assert.match(panel, /Импортировать из файла/);
  assert.match(panel, /Загрузить в черновик/);
  assert.match(panel, /Найдено \{importEntryCount\} записей/);
  assert.match(
    panel,
    /Импорт меняет только черновик\. Тея не увидит изменения до/,
  );
  assert.match(panel, /\/api\/admin\/bot\/knowledge\/entries\/import/);
  assert.match(panel, /Импортировано: создано \$\{data\.created\}/);
  assert.match(panel, /обновлено \$\{data\.updated\}/);
  assert.match(panel, /без изменений \$\{data\.unchanged\}/);
  assert.doesNotMatch(panel, /entries\/import[\s\S]*knowledge\/publish/);

  const stableKey = read("src/lib/bot-knowledge/stable-key.ts");
  assert.match(stableKey, /BOT_KNOWLEDGE_STABLE_KEY_RE/);
  assert.match(stableKey, /\[\.\_\-\]/);

  const payload = read("src/lib/bot-knowledge/publication-payload.ts");
  assert.match(payload, /BOT_KNOWLEDGE_STABLE_KEY_RE/);

  const types = read("src/types/bot-knowledge.ts");
  assert.match(types, /BotKnowledgeImportResultDto/);
  assert.match(types, /BotKnowledgeImportFileV1/);
}

function testPackageAndCi(): void {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:security:bot-knowledge-import"]);
  assert.ok(pkg.scripts["test:security:bot-knowledge-import-db"]);
  assert.ok(pkg.scripts["test:security:bot-knowledge-import-db:required"]);

  const workflow = read(".github/workflows/bot-internal-booking-create-pg-gate.yml");
  assert.match(workflow, /test:security:bot-knowledge-import/);
  assert.match(workflow, /test:security:bot-knowledge-import-db:required/);
  assert.match(workflow, /scripts\/security-bot-knowledge-import\*/);
  assert.match(workflow, /src\/lib\/bot-knowledge\/stable-key\.ts/);
}

function buildFixtureEntry(index: number, overrides: Record<string, unknown> = {}) {
  const categoryCycle = [
    "FAQ",
    "PROCEDURE_EXPLANATION",
    "PREPARATION",
    "AFTERCARE",
    "OBJECTION_HANDLING",
    "SAFETY_INFORMATION",
    "POLICY_EXPLANATION",
    "ESCALATION_GUIDANCE",
  ] as const;
  return {
    key: index === 0 ? "procedure.pm_general" : `import.entry-${index}`,
    category: categoryCycle[index % categoryCycle.length],
    title: `Title ${index}`,
    content: `Content body for entry ${index} without prices.`,
    tags: index % 3 === 0 ? [`tag-${index}`] : [],
    serviceId: null,
    ...overrides,
  };
}

function buildFixture(count: number, mapEntry?: (entry: ReturnType<typeof buildFixtureEntry>, index: number) => unknown) {
  const entries = Array.from({ length: count }, (_, index) => {
    const base = buildFixtureEntry(index);
    return mapEntry ? mapEntry(base, index) : base;
  });
  return { schemaVersion: 1 as const, entries };
}

async function testValidationRejects(): Promise<void> {
  process.env.SECURITY_BATCH_TEST = "1";
  const { installServerOnlyShimForSecurityScripts } = await import(
    "./lib/stub-server-only"
  );
  installServerOnlyShimForSecurityScripts();

  const { importBotKnowledgeEntries, BotKnowledgeEntryError } = await import(
    "../src/services/BotKnowledgeEntryService"
  );
  const userId = "00000000-0000-4000-8000-000000000001";

  const rejectCases: Array<{ label: string; body: unknown }> = [
    {
      label: "schemaVersion 2",
      body: { schemaVersion: 2, entries: [] },
    },
    {
      label: "unknown top-level field",
      body: { schemaVersion: 1, entries: [], extra: true },
    },
    {
      label: "unknown entry field",
      body: {
        schemaVersion: 1,
        entries: [{ ...buildFixtureEntry(1), price: 100 }],
      },
    },
    {
      label: "invalid category",
      body: {
        schemaVersion: 1,
        entries: [{ ...buildFixtureEntry(1), category: "SALES_GUIDANCE" }],
      },
    },
    {
      label: "duplicate key in file",
      body: {
        schemaVersion: 1,
        entries: [buildFixtureEntry(1), { ...buildFixtureEntry(2), key: "import.entry-1" }],
      },
    },
    {
      label: "live-SoT price copy",
      body: {
        schemaVersion: 1,
        entries: [
          {
            ...buildFixtureEntry(1),
            content: "Стоимость 1500 ₽",
          },
        ],
      },
    },
    {
      label: "invalid one among many",
      body: buildFixture(5, (entry, index) =>
        index === 3 ? { ...entry, category: "OTHER" } : entry,
      ),
    },
  ];

  for (const testCase of rejectCases) {
    await assert.rejects(
      () => importBotKnowledgeEntries(testCase.body, userId),
      (error: unknown) => {
        assert.ok(
          error instanceof BotKnowledgeEntryError,
          `${testCase.label}: expected BotKnowledgeEntryError`,
        );
        assert.equal(error.code, "VALIDATION", testCase.label);
        return true;
      },
      testCase.label,
    );
  }

  // 87-entry fixture must pass structural validation (DB write may still need services/tx).
  const fixture87 = buildFixture(87);
  assert.equal(fixture87.entries.length, 87);
  assert.equal(fixture87.entries[0].key, "procedure.pm_general");
  const keys = new Set(fixture87.entries.map((entry) => entry.key));
  assert.equal(keys.size, 87);
}

async function main(): Promise<void> {
  testStaticSurface();
  testPackageAndCi();
  await testValidationRejects();
  console.log("security-bot-knowledge-import-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
