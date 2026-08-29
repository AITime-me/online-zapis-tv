/**
 * BOT-CONTROL-PLANE-03B — PostgreSQL proofs for bot knowledge publications.
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BotKnowledgePublicationStatus,
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

async function loadEntryService() {
  return import("../src/services/BotKnowledgeEntryService");
}

async function loadPublicationService() {
  return import("../src/services/BotKnowledgePublicationService");
}

async function loadPayload() {
  return import("../src/lib/bot-knowledge/publication-payload");
}

async function resolveDatabaseUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "bot-knowledge-pub-pg",
      databaseName: "bot_knowledge_publication_test",
      password: "bot-knowledge-pub-test",
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
  const active = await prisma.botKnowledgePublication.findMany({
    where: {
      workspaceId: "default",
      status: BotKnowledgePublicationStatus.ACTIVE,
    },
  });
  assert.equal(active.length, 1, "exactly one ACTIVE knowledge publication");

  const workspace = await prisma.botKnowledgeWorkspace.findUniqueOrThrow({
    where: { id: "default" },
  });
  assert.equal(
    workspace.activePublicationId,
    active[0].id,
    "workspace.active_publication_id must point to ACTIVE publication",
  );

  const versions = await prisma.botKnowledgePublication.findMany({
    where: { workspaceId: "default" },
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
  await prisma.botKnowledgeWorkspace.updateMany({
    data: { activePublicationId: null },
  });
  await prisma.botKnowledgePublication.deleteMany({
    where: { workspaceId: "default" },
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
      "security-bot-knowledge-publication-db-check: SKIPPED (docker/ephemeral postgres unavailable)",
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
        email: `bot-kb-${runId}@example.com`,
        passwordHash: "test-hash",
        role: "OWNER",
        name: "Knowledge Test Owner",
      },
    });

    const {
      publishCurrentKnowledge,
      activateKnowledgePublication,
      getActiveBotKnowledgeRuntimePublication,
      getBotKnowledgePublicationState,
      BotKnowledgePublicationError,
    } = await loadPublicationService();
    const { createBotKnowledgeEntry, updateBotKnowledgeEntry } =
      await loadEntryService();
    const { hashBotKnowledgePublicationPayload, buildBotKnowledgePublicationPayloadFromEntries } =
      await loadPayload();

    // A. fresh migrations: no workspace seed, no auto-publish, no fake entries
    assert.equal(await prisma.botKnowledgeWorkspace.count(), 0);
    assert.equal(await prisma.botKnowledgeEntry.count(), 0);
    assert.equal(await prisma.botKnowledgePublication.count(), 0);
    assert.equal(await getActiveBotKnowledgeRuntimePublication(), null);

    // Settings / business tables remain available after migrate
    assert.ok(await prisma.user.findUnique({ where: { id: ownerId } }));

    const entryA = await createBotKnowledgeEntry(
      {
        stableKey: `faq-general-${runId}`,
        category: "FAQ",
        title: "Общий FAQ",
        content: "Ответ без цен и слотов.",
        tags: ["general"],
        isEnabled: true,
      },
      ownerId,
    );

    // Draft entries must never become runtime fallback when ACTIVE is absent.
    assert.ok((await prisma.botKnowledgeEntry.count()) >= 1);
    await resetPublications(prisma);
    assert.equal(
      await getActiveBotKnowledgeRuntimePublication(),
      null,
      "drafts present + no ACTIVE must not expose workspace entries via runtime loader",
    );

    await assert.rejects(
      () =>
        updateBotKnowledgeEntry(
          entryA.id,
          { stableKey: `changed-${runId}` },
          ownerId,
        ),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "code" in error);
        return true;
      },
    );

    // I. concurrent first publish
    const firstRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentKnowledge(ownerId),
        publishCurrentKnowledge(ownerId),
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

    // D. same checksum → UNCHANGED
    const unchanged = await publishCurrentKnowledge(ownerId);
    assert.equal(unchanged.outcome, "UNCHANGED");
    assert.equal(unchanged.publication.id, publishedFirstRace[0].publication.id);
    assert.equal(await prisma.botKnowledgePublication.count(), 1);

    // C. changed publish → v2
    await updateBotKnowledgeEntry(
      entryA.id,
      { content: `Обновлённый ответ ${runId}` },
      ownerId,
    );

    const changedRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentKnowledge(ownerId),
        publishCurrentKnowledge(ownerId),
      ]),
      "concurrent changed publish",
    );
    const publishedChangedRace = changedRace.filter((result) => result.outcome === "PUBLISHED");
    const unchangedChangedRace = changedRace.filter((result) => result.outcome === "UNCHANGED");
    assert.equal(publishedChangedRace.length, 1);
    assert.equal(unchangedChangedRace.length, 1);
    assert.equal(publishedChangedRace[0].publication.versionNumber, 2);
    await assertPublicationInvariants(prisma);

    // K. concurrent same payload
    const samePayloadRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentKnowledge(ownerId),
        publishCurrentKnowledge(ownerId),
      ]),
      "concurrent same-payload publish",
    );
    assert.equal(
      samePayloadRace.every((result) => result.outcome === "UNCHANGED"),
      true,
    );
    await assertPublicationInvariants(prisma);

    const rows = await prisma.botKnowledgePublication.findMany({
      orderBy: { versionNumber: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, BotKnowledgePublicationStatus.SUPERSEDED);
    assert.equal(rows[1].status, BotKnowledgePublicationStatus.ACTIVE);
    assert.notEqual(rows[0].payloadChecksum, rows[1].payloadChecksum);

    // E. immutable v1 after draft mutation
    const v1PayloadBefore = rows[0].payload;
    await updateBotKnowledgeEntry(
      entryA.id,
      { content: `mutate-after-publish-${runId}` },
      ownerId,
    );
    const v1After = await prisma.botKnowledgePublication.findUniqueOrThrow({
      where: { id: rows[0].id },
    });
    assert.deepEqual(v1After.payload, v1PayloadBefore);

    // Disabled entry excluded only after next Publish
    await createBotKnowledgeEntry(
      {
        stableKey: `faq-disabled-${runId}`,
        category: "FAQ",
        title: "Будет выключена",
        content: "Не должна остаться в ACTIVE после publish",
        tags: [],
        isEnabled: true,
      },
      ownerId,
    );
    const withEnabled = await publishCurrentKnowledge(ownerId);
    assert.equal(withEnabled.outcome, "PUBLISHED");
    const runtimeWithEnabled = await getActiveBotKnowledgeRuntimePublication();
    assert.ok(runtimeWithEnabled);
    assert.ok(
      runtimeWithEnabled.entries.some((entry) => entry.key === `faq-disabled-${runId}`),
    );

    const disabledEntry = await prisma.botKnowledgeEntry.findFirstOrThrow({
      where: { stableKey: `faq-disabled-${runId}` },
    });
    await updateBotKnowledgeEntry(
      disabledEntry.id,
      { isEnabled: false },
      ownerId,
    );
    const runtimeStillHasDisabled = await getActiveBotKnowledgeRuntimePublication();
    assert.ok(
      runtimeStillHasDisabled?.entries.some(
        (entry) => entry.key === `faq-disabled-${runId}`,
      ),
      "draft disable must not affect ACTIVE until publish",
    );
    const afterDisablePublish = await publishCurrentKnowledge(ownerId);
    assert.equal(afterDisablePublish.outcome, "PUBLISHED");
    const runtimeAfterDisable = await getActiveBotKnowledgeRuntimePublication();
    assert.ok(runtimeAfterDisable);
    assert.equal(
      runtimeAfterDisable.entries.some((entry) => entry.key === `faq-disabled-${runId}`),
      false,
    );

    // F. rollback v1
    const rolled = await activateKnowledgePublication(rows[0].id, ownerId);
    assert.equal(rolled.versionNumber, 1);
    assert.equal(rolled.status, "ACTIVE");
    await assertPublicationInvariants(prisma);

    // G. unknown publication rejected
    await assert.rejects(
      () => activateKnowledgePublication(randomUUID(), ownerId),
      (error: unknown) => {
        assert.ok(error instanceof BotKnowledgePublicationError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );

    // L. publish vs activate race
    await updateBotKnowledgeEntry(
      entryA.id,
      { content: `race-publish-${runId}` },
      ownerId,
    );
    const currentActiveBeforeRace = await prisma.botKnowledgePublication.findFirstOrThrow({
      where: {
        workspaceId: "default",
        status: BotKnowledgePublicationStatus.ACTIVE,
      },
    });
    const otherVersion = await prisma.botKnowledgePublication.findFirstOrThrow({
      where: {
        workspaceId: "default",
        id: { not: currentActiveBeforeRace.id },
      },
      orderBy: { versionNumber: "desc" },
    });

    const publishActivateRace = assertAllFulfilled(
      await Promise.allSettled([
        publishCurrentKnowledge(ownerId),
        activateKnowledgePublication(otherVersion.id, ownerId),
      ]),
      "publish vs activate race",
    );
    assert.ok(
      publishActivateRace.some(
        (result) => "outcome" in result && result.outcome === "PUBLISHED",
      ) ||
        publishActivateRace.some(
          (result) => "versionNumber" in result && result.status === "ACTIVE",
        ),
    );
    await assertPublicationInvariants(prisma);

    const state = await getBotKnowledgePublicationState();
    const drafts = await prisma.botKnowledgeEntry.findMany();
    const draftPayload = buildBotKnowledgePublicationPayloadFromEntries(
      drafts.map((row) => ({
        stableKey: row.stableKey,
        category: row.category,
        title: row.title,
        content: row.content,
        tags: row.tags,
        serviceId: row.serviceId,
        isEnabled: row.isEnabled,
      })),
    );
    const draftChecksum = hashBotKnowledgePublicationPayload(draftPayload);
    const activeAfterRace = await prisma.botKnowledgePublication.findFirstOrThrow({
      where: {
        workspaceId: "default",
        status: BotKnowledgePublicationStatus.ACTIVE,
      },
    });
    assert.equal(
      state.hasUnpublishedChanges,
      activeAfterRace.payloadChecksum !== draftChecksum,
    );

    const runtime = await getActiveBotKnowledgeRuntimePublication();
    assert.ok(runtime);
    assert.equal(runtime.checksum, activeAfterRace.payloadChecksum);
    assert.equal(runtime.knowledgePublicationId, activeAfterRace.id);

    // H. corrupt ACTIVE rejected
    const corruptedPayload = {
      ...(activeAfterRace.payload as Prisma.JsonObject),
      corruptedField: "must-reject",
    };
    await prisma.botKnowledgePublication.update({
      where: { id: activeAfterRace.id },
      data: { payload: corruptedPayload },
    });

    await assert.rejects(
      () => getActiveBotKnowledgeRuntimePublication(),
      (error: unknown) => {
        assert.ok(error instanceof BotKnowledgePublicationError);
        assert.equal(error.code, "CONFLICT");
        return true;
      },
    );

    // Independence: settings publications table untouched by knowledge publish path
    // (may be empty on fresh DB — just ensure knowledge ops don't require settings publish)
    assert.ok(await prisma.botKnowledgeWorkspace.findUnique({ where: { id: "default" } }));

    console.log("security-bot-knowledge-publication-db-check: OK");
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
