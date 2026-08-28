/**
 * BOT-CONTROL-PLANE-02 — PostgreSQL proofs for bot settings publications.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BotSettingsPublicationStatus,
  PrismaClient,
  type Prisma,
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

async function loadBotSettingsService() {
  return import("../src/services/BotSettingsService");
}

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

async function assertPublicationInvariants(prisma: PrismaClient): Promise<void> {
  const active = await prisma.botSettingsPublication.findMany({
    where: {
      botSettingsId: "default",
      status: BotSettingsPublicationStatus.ACTIVE,
    },
  });
  assert.equal(active.length, 1, "exactly one ACTIVE publication");

  const settings = await prisma.botSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  assert.equal(
    settings.activePublicationId,
    active[0].id,
    "bot_settings.active_publication_id must point to ACTIVE publication",
  );

  const versions = await prisma.botSettingsPublication.findMany({
    where: { botSettingsId: "default" },
    select: { versionNumber: true, payload: true },
    orderBy: { versionNumber: "asc" },
  });
  const versionNumbers = versions.map((row) => row.versionNumber);
  assert.equal(
    new Set(versionNumbers).size,
    versionNumbers.length,
    "version numbers must be unique",
  );
  for (let index = 1; index < versionNumbers.length; index += 1) {
    assert.ok(
      versionNumbers[index] > versionNumbers[index - 1],
      "version numbers must be monotonic",
    );
  }

  for (const row of versions) {
    assert.ok(row.payload && typeof row.payload === "object", "payload must be preserved");
  }
}

async function resetPublications(prisma: PrismaClient): Promise<void> {
  await prisma.botSettingsPublication.deleteMany({
    where: { botSettingsId: "default" },
  });
  await prisma.botSettings.update({
    where: { id: "default" },
    data: { activePublicationId: null },
  });
}

function assertAllFulfilled<T>(
  results: PromiseSettledResult<T>[],
  label: string,
): T[] {
  const values: T[] = [];
  for (const result of results) {
    assert.equal(
      result.status,
      "fulfilled",
      `${label}: expected fulfilled, got ${result.status}${
        result.status === "rejected" ? `: ${String(result.reason)}` : ""
      }`,
    );
    values.push((result as PromiseFulfilledResult<T>).value);
  }
  return values;
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

    const settingsBeforeBootstrap = await prisma.botSettings.findUnique({
      where: { id: "default" },
    });
    assert.equal(
      settingsBeforeBootstrap,
      null,
      "fresh migrated DB must not seed bot_settings/default",
    );

    const { getBotSettings } = await loadBotSettingsService();
    const bootstrappedSettings = await getBotSettings();
    assert.equal(bootstrappedSettings.id, "default");

    const settingsAfterBootstrap = await prisma.botSettings.findUniqueOrThrow({
      where: { id: "default" },
    });
    assert.equal(settingsAfterBootstrap.id, "default");

    const runtimeBefore = await getActiveBotSettingsRuntimePublication();
    assert.equal(runtimeBefore, null);

    await resetPublications(prisma);

    const firstRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentBotSettings(ownerId),
        publishCurrentBotSettings(ownerId),
      ]),
      "concurrent first publish",
    );
    const publishedFirstRace = firstRace.filter((result) => result.outcome === "PUBLISHED");
    const unchangedFirstRace = firstRace.filter((result) => result.outcome === "UNCHANGED");
    assert.equal(publishedFirstRace.length, 1);
    assert.equal(unchangedFirstRace.length, 1);
    assert.equal(publishedFirstRace[0].publication.versionNumber, 1);
    assert.equal(
      unchangedFirstRace[0].publication.id,
      publishedFirstRace[0].publication.id,
    );
    await assertPublicationInvariants(prisma);

    const unchanged = await publishCurrentBotSettings(ownerId);
    assert.equal(unchanged.outcome, "UNCHANGED");
    assert.equal(unchanged.publication.id, publishedFirstRace[0].publication.id);

    const countAfterIdempotent = await prisma.botSettingsPublication.count();
    assert.equal(countAfterIdempotent, 1);

    await prisma.botSettings.update({
      where: { id: "default" },
      data: { handoffRules: `handoff-${runId}` },
    });

    const changedRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentBotSettings(ownerId),
        publishCurrentBotSettings(ownerId),
      ]),
      "concurrent changed publish",
    );
    const publishedChangedRace = changedRace.filter((result) => result.outcome === "PUBLISHED");
    const unchangedChangedRace = changedRace.filter((result) => result.outcome === "UNCHANGED");
    assert.equal(publishedChangedRace.length, 1);
    assert.equal(unchangedChangedRace.length, 1);
    assert.equal(publishedChangedRace[0].publication.versionNumber, 2);
    await assertPublicationInvariants(prisma);

    const samePayloadRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentBotSettings(ownerId),
        publishCurrentBotSettings(ownerId),
      ]),
      "concurrent same-payload publish",
    );
    assert.equal(
      samePayloadRace.every((result) => result.outcome === "UNCHANGED"),
      true,
    );
    await assertPublicationInvariants(prisma);

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

    const rolled = await activateBotSettingsPublication(rows[0].id, ownerId);
    assert.equal(rolled.versionNumber, 1);
    assert.equal(rolled.status, "ACTIVE");
    await assertPublicationInvariants(prisma);

    await assert.rejects(
      () => activateBotSettingsPublication(randomUUID(), ownerId),
      (error: unknown) => {
        assert.ok(error instanceof BotSettingsPublicationError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );

    await prisma.botSettings.update({
      where: { id: "default" },
      data: { safetyRules: `race-publish-${runId}` },
    });

    const publishActivateRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentBotSettings(ownerId),
        activateBotSettingsPublication(rows[1].id, ownerId),
      ]),
      "publish vs activate race",
    );
    assert.ok(
      publishActivateRace.some((result) => "outcome" in result && result.outcome === "PUBLISHED"),
    );
    await assertPublicationInvariants(prisma);

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
    const currentDraftPayload = buildBotSettingsPublicationPayloadFromDraft(draft);
    const currentDraftChecksum = hashBotSettingsPublicationPayload(currentDraftPayload);

    const activeAfterRace = await prisma.botSettingsPublication.findFirstOrThrow({
      where: {
        botSettingsId: "default",
        status: BotSettingsPublicationStatus.ACTIVE,
      },
    });
    const expectedHasUnpublishedChanges =
      activeAfterRace.payloadChecksum !== currentDraftChecksum;

    const state = await getBotSettingsPublicationState();
    assert.equal(
      state.hasUnpublishedChanges,
      expectedHasUnpublishedChanges,
      "hasUnpublishedChanges must reflect ACTIVE vs current draft checksum after serialized publish/activate race",
    );

    const runtime = await getActiveBotSettingsRuntimePublication();
    assert.ok(runtime);
    assert.equal(runtime.checksum, activeAfterRace.payloadChecksum);
    assert.equal(runtime.settings.operationalSafety.emergencyLockOwnedByBotCoreEnv, true);

    const activeRow = activeAfterRace;
    const corruptedPayload = {
      ...(activeRow.payload as Prisma.JsonObject),
      corruptedField: "must-reject",
    };
    await prisma.botSettingsPublication.update({
      where: { id: activeRow.id },
      data: { payload: corruptedPayload },
    });

    await assert.rejects(
      () => getActiveBotSettingsRuntimePublication(),
      (error: unknown) => {
        assert.ok(error instanceof BotSettingsPublicationError);
        assert.equal(error.code, "CONFLICT");
        return true;
      },
    );

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
