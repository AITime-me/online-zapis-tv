/**
 * BOT-KB-IMPORT-01 — PostgreSQL proofs for managed KB draft import.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  canReachPostgres,
  startEphemeralPostgres,
  runPrismaMigrateDeploy,
  type EphemeralPostgres,
} from "./lib/ephemeral-postgres";
import { installServerOnlyShimForSecurityScripts } from "./lib/stub-server-only";

installServerOnlyShimForSecurityScripts();

const REQUIRE_POSTGRES =
  process.argv.includes("--require-postgres") ||
  process.env.SECURITY_REQUIRE_PG === "1";

async function loadEntryService() {
  return import("../src/services/BotKnowledgeEntryService");
}

async function resolveDatabaseUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "bot-knowledge-import-pg",
      databaseName: "bot_knowledge_import_test",
      password: "bot-knowledge-import-test",
    });
  } catch {
    ephemeral = null;
  }

  if (ephemeral) {
    return {
      databaseUrl: ephemeral.databaseUrl,
      cleanup: ephemeral.cleanup,
    };
  }

  const envUrl = process.env.DATABASE_URL?.trim();
  if (envUrl && (await canReachPostgres(envUrl))) {
    return {
      databaseUrl: envUrl,
      cleanup: async () => undefined,
    };
  }

  throw new Error("ephemeral postgres unavailable");
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
    serviceId: null as string | null,
    ...overrides,
  };
}

function buildFixture(count: number) {
  return {
    schemaVersion: 1 as const,
    entries: Array.from({ length: count }, (_, index) => buildFixtureEntry(index)),
  };
}

async function main(): Promise<void> {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const resolved = await resolveDatabaseUrl();
    cleanup = resolved.cleanup;
    process.env.DATABASE_URL = resolved.databaseUrl;
    runPrismaMigrateDeploy(resolved.databaseUrl);
  } catch (error) {
    if (REQUIRE_POSTGRES) {
      throw error;
    }
    console.log(
      "security-bot-knowledge-import-db-check: SKIPPED (docker/ephemeral postgres unavailable)",
    );
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  const runId = randomUUID().slice(0, 8);
  const ownerId = randomUUID();

  try {
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `bot-kb-import-${runId}@example.com`,
        passwordHash: "test-hash",
        role: "OWNER",
        name: "Knowledge Import Owner",
      },
    });

    const {
      createBotKnowledgeEntry,
      importBotKnowledgeEntries,
      BotKnowledgeEntryError,
    } = await loadEntryService();

    // Pre-existing manual draft with dotted key; must upsert, not duplicate.
    const existing = await createBotKnowledgeEntry(
      {
        stableKey: "procedure.pm_general",
        category: "PROCEDURE_EXPLANATION",
        title: "Old PM title",
        content: "Old PM content without prices.",
        tags: ["old"],
        isEnabled: false,
      },
      ownerId,
    );
    assert.equal(existing.isEnabled, false);

    const pubCountBefore = await prisma.botKnowledgePublication.count();
    const activeBefore = await prisma.botKnowledgePublication.count({
      where: { status: "ACTIVE" },
    });
    assert.equal(pubCountBefore, 0);
    assert.equal(activeBefore, 0);

    const fixture = buildFixture(87);
    // Force update path for procedure.pm_general
    fixture.entries[0] = buildFixtureEntry(0, {
      title: "Updated PM title",
      content: "Updated PM content without prices.",
      tags: ["pm"],
      category: "PROCEDURE_EXPLANATION",
    });

    const first = await importBotKnowledgeEntries(fixture, ownerId);
    assert.equal(first.total, 87);
    assert.equal(first.created, 86);
    assert.equal(first.updated, 1);
    assert.equal(first.unchanged, 0);

    const byKey = await prisma.botKnowledgeEntry.groupBy({
      by: ["stableKey"],
      _count: { _all: true },
    });
    assert.equal(byKey.length, 87);
    assert.ok(byKey.every((row) => row._count._all === 1));

    const pm = await prisma.botKnowledgeEntry.findUniqueOrThrow({
      where: { stableKey: "procedure.pm_general" },
    });
    assert.equal(pm.id, existing.id);
    assert.equal(pm.title, "Updated PM title");
    assert.equal(pm.isEnabled, false, "import must preserve isEnabled on update");
    assert.equal(pm.content, "Updated PM content without prices.");

    assert.equal(await prisma.botKnowledgePublication.count(), pubCountBefore);
    assert.equal(
      await prisma.botKnowledgePublication.count({ where: { status: "ACTIVE" } }),
      0,
    );

    const second = await importBotKnowledgeEntries(fixture, ownerId);
    assert.equal(second.total, 87);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 87);
    assert.equal(await prisma.botKnowledgeEntry.count(), 87);
    assert.equal(await prisma.botKnowledgePublication.count(), 0);

    // Invalid one entry among many → no partial write
    const beforeInvalid = await prisma.botKnowledgeEntry.findMany({
      select: { stableKey: true, title: true, updatedAt: true },
      orderBy: { stableKey: "asc" },
    });
    const badFixture = {
      schemaVersion: 1 as const,
      entries: [
        ...fixture.entries.slice(0, 3),
        { ...buildFixtureEntry(3), category: "OTHER" },
        ...fixture.entries.slice(4, 8),
      ],
    };
    await assert.rejects(
      () => importBotKnowledgeEntries(badFixture, ownerId),
      (error: unknown) => error instanceof BotKnowledgeEntryError,
    );
    const afterInvalid = await prisma.botKnowledgeEntry.findMany({
      select: { stableKey: true, title: true, updatedAt: true },
      orderBy: { stableKey: "asc" },
    });
    assert.deepEqual(afterInvalid, beforeInvalid);

    // Duplicate key in file → reject, no write
    await assert.rejects(
      () =>
        importBotKnowledgeEntries(
          {
            schemaVersion: 1,
            entries: [
              buildFixtureEntry(10),
              { ...buildFixtureEntry(11), key: "import.entry-10" },
            ],
          },
          ownerId,
        ),
      (error: unknown) =>
        error instanceof BotKnowledgeEntryError &&
        /Дубликат key/.test(error.message),
    );

    console.log("security-bot-knowledge-import-db-check: OK");
  } finally {
    await prisma.$disconnect();
    if (cleanup) {
      await cleanup();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
