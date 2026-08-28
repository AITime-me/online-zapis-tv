/**
 * BOT-CONTROL-PLANE-02 — PostgreSQL proofs for bot settings publications.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BotSettingsPublicationStatus,
  PrismaClient,
} from "@prisma/client";
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

async function loadPublicationService() {
  return import("../src/services/BotSettingsPublicationService");
}

async function loadPayload() {
  return import("../src/lib/bot-settings/publication-payload");
}

async function resolveDatabaseUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "bot-settings-pub-pg",
      databaseName: "bot_settings_publication_test",
      password: "bot-settings-pub-test",
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
      "security-bot-settings-publication-db-check: SKIPPED (docker/ephemeral postgres unavailable)",
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
        email: `bot-pub-${runId}@example.com`,
        passwordHash: "test-hash",
        role: "OWNER",
        name: "Publication Test Owner",
      },
    });

    const {
      publishCurrentBotSettings,
      activateBotSettingsPublication,
      getActiveBotSettingsRuntimePublication,
      getBotSettingsPublicationState,
      BotSettingsPublicationError,
    } = await loadPublicationService();

    const runtimeBefore = await getActiveBotSettingsRuntimePublication();
    assert.equal(runtimeBefore, null);

    const first = await publishCurrentBotSettings(ownerId);
    assert.equal(first.outcome, "PUBLISHED");
    assert.equal(first.publication.versionNumber, 1);
    assert.equal(first.publication.status, "ACTIVE");

    const unchanged = await publishCurrentBotSettings(ownerId);
    assert.equal(unchanged.outcome, "UNCHANGED");
    assert.equal(unchanged.publication.id, first.publication.id);

    const countAfterIdempotent = await prisma.botSettingsPublication.count();
    assert.equal(countAfterIdempotent, 1);

    await prisma.botSettings.update({
      where: { id: "default" },
      data: { handoffRules: `handoff-${runId}` },
    });

    const second = await publishCurrentBotSettings(ownerId);
    assert.equal(second.outcome, "PUBLISHED");
    assert.equal(second.publication.versionNumber, 2);

    const rows = await prisma.botSettingsPublication.findMany({
      orderBy: { versionNumber: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, BotSettingsPublicationStatus.SUPERSEDED);
    assert.equal(rows[1].status, BotSettingsPublicationStatus.ACTIVE);
    assert.notEqual(rows[0].payloadChecksum, rows[1].payloadChecksum);

    const v1PayloadBefore = rows[0].payload;
    await prisma.botSettings.update({
      where: { id: "default" },
      data: { mainInstruction: `mutate-after-publish-${runId}` },
    });
    const v1After = await prisma.botSettingsPublication.findUniqueOrThrow({
      where: { id: rows[0].id },
    });
    assert.deepEqual(v1After.payload, v1PayloadBefore);

    const activeCount = await prisma.botSettingsPublication.count({
      where: { status: BotSettingsPublicationStatus.ACTIVE },
    });
    assert.equal(activeCount, 1);

    const rolled = await activateBotSettingsPublication(rows[0].id, ownerId);
    assert.equal(rolled.versionNumber, 1);
    assert.equal(rolled.status, "ACTIVE");

    const activeAfterRollback = await prisma.botSettingsPublication.findMany({
      where: { status: BotSettingsPublicationStatus.ACTIVE },
    });
    assert.equal(activeAfterRollback.length, 1);
    assert.equal(activeAfterRollback[0].id, rows[0].id);

    await assert.rejects(
      () => activateBotSettingsPublication(randomUUID(), ownerId),
      (error: unknown) => {
        assert.ok(error instanceof BotSettingsPublicationError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );

    const runtime = await getActiveBotSettingsRuntimePublication();
    assert.ok(runtime);
    assert.equal(runtime.publicationId, rows[0].id);
    assert.equal(runtime.version, 1);
    assert.equal(runtime.checksum, rows[0].payloadChecksum);
    assert.equal(runtime.settings.operationalSafety.emergencyLockOwnedByBotCoreEnv, true);

    const state = await getBotSettingsPublicationState();
    assert.equal(state.hasUnpublishedChanges, true);
    assert.equal(state.active?.versionNumber, 1);

    const { hashBotSettingsPublicationPayload, buildBotSettingsPublicationPayloadFromDraft } =
      await loadPayload();
    const draft = await prisma.botSettings.findUniqueOrThrow({
      where: { id: "default" },
      select: {
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
        updatedAt: true,
      },
    });
    const payload = buildBotSettingsPublicationPayloadFromDraft(draft);
    const checksum = hashBotSettingsPublicationPayload(payload);
    assert.notEqual(checksum, runtime.checksum);

    const settingsRow = await prisma.botSettings.findUniqueOrThrow({
      where: { id: "default" },
    });
    assert.ok(settingsRow);
    assert.equal(settingsRow.id, "default");

    console.log("security-bot-settings-publication-db-check: OK");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    if (cleanup) {
      await cleanup();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
