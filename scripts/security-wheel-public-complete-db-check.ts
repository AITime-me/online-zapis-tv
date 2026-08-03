import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createWheelAttemptId } from "../src/lib/game/wheel/client-attempt-id";
import {
  DEFAULT_WHEEL_PRIZE_DEFINITIONS,
  buildDefaultWheelCatalogSettings,
  serializeDefaultPrizeRules,
} from "../src/lib/game/wheel/default-prizes";
import { hashOpaqueToken } from "../src/lib/game/session/game-session-token";
import { hashParticipantPhone } from "../src/lib/game/wheel/participant-phone-hash";
import { normalizeGameBookingPhoneKey } from "../src/lib/game/game-open-request-policy";
import {
  completeWheelPublicGame,
  startWheelPublicGame,
  WheelPublicGameError,
} from "../src/services/WheelPublicGameService";
import { REQUIRED_PUBLISHED_LEGAL_SLUGS, LEGAL_DOCUMENT_SEED_METADATA } from "../src/lib/legal-document/defaults";
import { hashLegalDocumentContent } from "../src/lib/legal-document/content-hash";
import { buildCatalogSessionCookieName } from "../src/lib/game/session/game-session-cookie";
import { LegalDocumentVersionStatus } from "@prisma/client";

const TEST_ENV = {
  NODE_ENV: "test",
  AUTH_SECRET: "test-auth-secret-16chars-min",
  SECURITY_BATCH_TEST: "1",
} as NodeJS.ProcessEnv;

const CATALOG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOG_SLUG = "permanent-wheel";
const VISITOR_TOKEN = "visitor-wheel-complete-pg";
const VISITOR_HASH = hashOpaqueToken(VISITOR_TOKEN);

async function canReachPostgres(databaseUrl: string): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function resolveEphemeralPostgresUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
} | null> {
  const dockerProbe = spawnSync("docker", ["info"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (dockerProbe.status !== 0) {
    return null;
  }

  const containerName = `wheel-complete-pg-${Date.now()}`;
  const password = "wheel-complete-test";
  const port = String(56432 + (Date.now() % 1000));
  const run = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=wheel_complete",
      "-p",
      `${port}:5432`,
      "postgres:16-alpine",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (run.status !== 0) {
    return null;
  }

  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/wheel_complete`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await canReachPostgres(databaseUrl)) {
      return {
        databaseUrl,
        cleanup: async () => {
          spawnSync("docker", ["rm", "-f", containerName], {
            encoding: "utf8",
            timeout: 30_000,
          });
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  spawnSync("docker", ["rm", "-f", containerName], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return null;
}

async function publishRequiredLegalDocuments(prisma: PrismaClient): Promise<void> {
  for (const document of LEGAL_DOCUMENT_SEED_METADATA) {
    if (!REQUIRED_PUBLISHED_LEGAL_SLUGS.includes(document.slug as never)) {
      continue;
    }
    const created = await prisma.legalDocument.upsert({
      where: { slug: document.slug },
      update: {},
      create: {
        slug: document.slug,
        title: document.title,
        publicPath: document.publicPath,
        content: "",
        isPublished: false,
      },
    });
    const latest = await prisma.legalDocumentVersion.findFirst({
      where: { documentId: created.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    const content = `Published content for ${document.slug}`;
    const version = await prisma.legalDocumentVersion.create({
      data: {
        documentId: created.id,
        versionNumber: nextVersionNumber,
        title: document.title,
        content,
        contentHash: hashLegalDocumentContent(content),
        status: LegalDocumentVersionStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    await prisma.legalDocument.update({
      where: { id: created.id },
      data: {
        currentPublishedVersionId: version.id,
        isPublished: true,
        content: version.content,
      },
    });
  }
}

function wheelCompleteRequest(sessionToken: string): Request {
  const cookieName = buildCatalogSessionCookieName(CATALOG_SLUG);
  return new Request("http://localhost/api/game/wheel/complete", {
    method: "POST",
    headers: {
      Cookie: `${cookieName}=${sessionToken}`,
    },
  });
}

async function seedWheelCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.studioSettings.upsert({
    where: { id: "default" },
    update: { isGameEnabled: true },
    create: {
      id: "default",
      isGameEnabled: true,
    },
  });

  await prisma.gameCatalog.upsert({
    where: { id: CATALOG_ID },
    update: {
      slug: CATALOG_SLUG,
      type: "WHEEL_OF_FORTUNE",
      status: "ACTIVE",
      settings: buildDefaultWheelCatalogSettings() as object,
      campaignKey: "permanent-wheel",
    },
    create: {
      id: CATALOG_ID,
      slug: CATALOG_SLUG,
      title: "Колесо фортуны",
      type: "WHEEL_OF_FORTUNE",
      status: "ACTIVE",
      settings: buildDefaultWheelCatalogSettings() as object,
      campaignKey: "permanent-wheel",
      rulesVersion: "1",
    },
  });

  for (const [index, definition] of DEFAULT_WHEEL_PRIZE_DEFINITIONS.entries()) {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    await prisma.gameGift.upsert({
      where: { id },
      update: {
        name: definition.name,
        isActive: definition.isActive,
        probability: definition.sectorCount,
        systemKey: definition.systemKey,
        sortOrder: definition.sortOrder,
        prizeType: definition.prizeType,
        prizeRules: serializeDefaultPrizeRules(definition) as object,
      },
      create: {
        id,
        gameCatalogId: CATALOG_ID,
        name: definition.name,
        shortDescription: definition.shortDescription,
        probability: definition.sectorCount,
        systemKey: definition.systemKey,
        sortOrder: definition.sortOrder,
        isActive: definition.isActive,
        prizeType: definition.prizeType,
        prizeRules: serializeDefaultPrizeRules(definition) as object,
        activationMode: "SINGLE_PAID_SERVICE",
        activationConditionText: definition.activationConditionText,
        priority: definition.systemKey === "permanent_discount_20" ? "jackpot" : "standard",
        cardStyle: "default",
      },
    });
  }
}

async function assertPostgresCompleteProof(): Promise<void> {
  const ephemeral = await resolveEphemeralPostgresUrl();
  if (!ephemeral) {
    throw new Error(
      "wheel-public-complete-db: docker postgres unavailable — PG proof required",
    );
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = ephemeral.databaseUrl;

  const migrate = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy"],
    {
      encoding: "utf8",
      timeout: 300_000,
      env: { ...process.env, DATABASE_URL: ephemeral.databaseUrl },
      shell: true,
    },
  );
  if (migrate.status !== 0) {
    await ephemeral.cleanup();
    throw new Error(`prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: ephemeral.databaseUrl } },
  });

  try {
    await publishRequiredLegalDocuments(prisma);
    await seedWheelCatalog(prisma);

    const now = new Date("2026-08-03T12:00:00.000Z");
    const phone = "+79991234567";
    const attemptId = createWheelAttemptId();
    const auth = { visitorToken: VISITOR_TOKEN, sessionToken: null as string | null };

    const started = await startWheelPublicGame({
      catalogSlug: CATALOG_SLUG,
      name: "Полина",
      phone,
      attemptId,
      personalDataConsent: true,
      offerAcknowledgement: true,
      auth,
      now,
      db: prisma,
      env: TEST_ENV,
      isGameEnabled: true,
    });

    const sectorIndex = started.animation.sectorIndex;
    const prizeName = started.animation.prizeDisplayName;

    await assert.rejects(
      () =>
        completeWheelPublicGame({
          catalogSlug: CATALOG_SLUG,
          interest: "lips",
          name: "Полина",
          phone: "+79990001122",
          personalDataConsent: true,
          offerAcknowledgement: true,
          auth: {
            visitorToken: VISITOR_TOKEN,
            sessionToken: started.sessionToken,
          },
          request: wheelCompleteRequest(started.sessionToken),
          idempotencyKey: "pg-phone-mismatch",
          now,
          db: prisma,
          env: TEST_ENV,
        }),
      (error: unknown) =>
        error instanceof WheelPublicGameError &&
        error.code === "GAME_SESSION_FORBIDDEN",
    );

    const request = wheelCompleteRequest(started.sessionToken);

    const first = await completeWheelPublicGame({
      catalogSlug: CATALOG_SLUG,
      interest: "lips",
      name: "Полина",
      phone: "8 (999) 123-45-67",
      personalDataConsent: true,
      offerAcknowledgement: true,
      auth: {
        visitorToken: VISITOR_TOKEN,
        sessionToken: started.sessionToken,
      },
      request,
      idempotencyKey: "pg-complete-1",
      now,
      db: prisma,
      env: TEST_ENV,
    });

    const bookingsAfterFirst = await prisma.bookingRequest.count();
    const legalAfterFirst = await prisma.legalAcceptance.count({
      where: { gamePlayId: { not: null } },
    });
    assert.equal(bookingsAfterFirst, 1);
    assert.equal(legalAfterFirst, 1);

    const concurrent = await Promise.all([
      completeWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        interest: "lips",
        name: "Полина",
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
        auth: {
          visitorToken: VISITOR_TOKEN,
          sessionToken: started.sessionToken,
        },
        request,
        idempotencyKey: "pg-concurrent-same",
        now,
        db: prisma,
        env: TEST_ENV,
      }),
      completeWheelPublicGame({
        catalogSlug: CATALOG_SLUG,
        interest: "lips",
        name: "Полина",
        phone,
        personalDataConsent: true,
        offerAcknowledgement: true,
        auth: {
          visitorToken: VISITOR_TOKEN,
          sessionToken: started.sessionToken,
        },
        request,
        idempotencyKey: "pg-concurrent-same",
        now,
        db: prisma,
        env: TEST_ENV,
      }),
    ]);
    assert.equal(concurrent[0]!.bookingRequestId, concurrent[1]!.bookingRequestId);
    assert.equal(await prisma.bookingRequest.count(), 1);

    const conflictingInterest = await completeWheelPublicGame({
      catalogSlug: CATALOG_SLUG,
      interest: "brows",
      name: "Полина",
      phone,
      personalDataConsent: true,
      offerAcknowledgement: true,
      auth: {
        visitorToken: VISITOR_TOKEN,
        sessionToken: started.sessionToken,
      },
      request,
      idempotencyKey: "pg-conflict-interest",
      now,
      db: prisma,
      env: TEST_ENV,
    });
    assert.equal(conflictingInterest.bookingRequestId, first.bookingRequestId);
    assert.equal(await prisma.bookingRequest.count(), 1);

    const play = await prisma.gamePlay.findFirst({
      where: { gameSession: { tokenHash: hashOpaqueToken(started.sessionToken) } },
      select: { giftSnapshot: true },
    });
    const snapshot = play?.giftSnapshot as { confirmedInterest?: string } | null;
    assert.equal(snapshot?.confirmedInterest, "lips_permanent");

    await prisma.gameGift.updateMany({
      where: { gameCatalogId: CATALOG_ID },
      data: { isActive: false, name: "MUTATED" },
    });
    await prisma.gameCatalog.update({
      where: { id: CATALOG_ID },
      data: { status: "DISABLED" },
    });

    const retry = await completeWheelPublicGame({
      catalogSlug: CATALOG_SLUG,
      interest: "lips",
      name: "Полина",
      phone,
      personalDataConsent: true,
      offerAcknowledgement: true,
      auth: {
        visitorToken: VISITOR_TOKEN,
        sessionToken: started.sessionToken,
      },
      request,
      idempotencyKey: "pg-retry",
      now,
      db: prisma,
      env: TEST_ENV,
    });
    assert.equal(retry.bookingRequestId, first.bookingRequestId);
    assert.equal(retry.originalPrizeDisplayName, prizeName);

    const session = await prisma.gameSession.findFirst({
      where: { tokenHash: hashOpaqueToken(started.sessionToken) },
      select: { serverAssignment: true },
    });
    const assignment = session?.serverAssignment as { sectorIndex?: number } | null;
    assert.equal(assignment?.sectorIndex, sectorIndex);

    const phoneHash = hashParticipantPhone({
      normalizedPhone: normalizeGameBookingPhoneKey(phone)!,
      gameCatalogId: CATALOG_ID,
      campaignKeySnapshot: "permanent-wheel",
      env: TEST_ENV,
    });
    assert.ok(phoneHash);
    void VISITOR_HASH;

    console.log("wheel-public-complete-db: PG complete proof PASS");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    process.env.DATABASE_URL = previousDatabaseUrl;
    await ephemeral.cleanup();
  }
}

async function main(): Promise<void> {
  await assertPostgresCompleteProof();
  console.log("security-wheel-public-complete-db-check: OK");
}

void main();
