/**
 * BOT-CONTROL-PLANE-05 — required PostgreSQL proofs for LIVE business facts.
 *
 * Proves current Service.priceFrom is returned immediately without any Publish step.
 * Must not silently SKIP when --require-postgres / SECURITY_REQUIRE_PG=1.
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

async function resolveDatabaseUrl(): Promise<{
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "bot-live-facts-pg",
      databaseName: "bot_live_facts_test",
      password: "bot-live-facts-test",
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

async function loadLiveFactsService() {
  return import("../src/services/BotLiveFactsService");
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
      "security-bot-live-facts-db-check: SKIPPED (docker/ephemeral postgres unavailable)",
    );
    return;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const runId = randomUUID().slice(0, 8);
  const categoryId = randomUUID();
  const serviceOnlineId = randomUUID();
  const serviceManagerId = randomUUID();
  const serviceInactiveId = randomUUID();
  const masterLinkedId = randomUUID();
  const masterUnlinkedId = randomUUID();

  try {
    await prisma.studioSettings.upsert({
      where: { id: "default" },
      update: {
        studioName: `LiveFacts Studio ${runId}`,
        phone: "8 900 000-00-00",
        email: `live-facts-${runId}@example.com`,
        address: "Test Address",
        workingHoursText: "10:00-20:00",
        isOnlineBookingEnabled: true,
      },
      create: {
        id: "default",
        studioName: `LiveFacts Studio ${runId}`,
        phone: "8 900 000-00-00",
        email: `live-facts-${runId}@example.com`,
        address: "Test Address",
        workingHoursText: "10:00-20:00",
        isOnlineBookingEnabled: true,
      },
    });

    await prisma.serviceCategory.create({
      data: {
        id: categoryId,
        name: `LF Cat ${runId}`,
        sortOrder: 1,
        isActive: true,
        isPublic: true,
      },
    });

    await prisma.service.createMany({
      data: [
        {
          id: serviceOnlineId,
          categoryId,
          internalName: `lf-online-${runId}`,
          publicName: `LF Online ${runId}`,
          durationMinutes: 60,
          priceFrom: "2500.00",
          priceTo: "2500.00",
          sortOrder: 2,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
        {
          id: serviceManagerId,
          categoryId,
          internalName: `lf-mgr-${runId}`,
          publicName: `LF Manager ${runId}`,
          durationMinutes: 90,
          priceFrom: "4000.50",
          priceTo: null,
          sortOrder: 1,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: false,
        },
        {
          id: serviceInactiveId,
          categoryId,
          internalName: `lf-off-${runId}`,
          publicName: `LF Inactive ${runId}`,
          durationMinutes: 30,
          priceFrom: "1000",
          priceTo: "1000",
          sortOrder: 3,
          isActive: false,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      ],
    });

    await prisma.master.createMany({
      data: [
        {
          id: masterLinkedId,
          internalName: `lf-m1-${runId}`,
          publicName: `LF Master Linked ${runId}`,
          workStart: "10:00",
          workEnd: "20:00",
          sortOrder: 1,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
        {
          id: masterUnlinkedId,
          internalName: `lf-m2-${runId}`,
          publicName: `LF Master Unlinked ${runId}`,
          workStart: "10:00",
          workEnd: "20:00",
          sortOrder: 2,
          isActive: true,
          isPublic: true,
          isOnlineBookingEnabled: true,
        },
      ],
    });

    await prisma.masterService.create({
      data: {
        masterId: masterLinkedId,
        serviceId: serviceOnlineId,
        isEnabled: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
      },
    });

    // Knowledge / settings publication tables must not be required for live facts.
    const kbCountBefore = await prisma.botKnowledgePublication.count();
    const settingsPubBefore = await prisma.botSettingsPublication.count();

    const { buildBotLiveFactsPayload } = await loadLiveFactsService();

    const first = await buildBotLiveFactsPayload({
      db: prisma,
      resolveTiming: async () => ({
        durationMinutes: 60,
        breakAfterMinutes: 0,
      }),
      isStudioOnlineBookingEnabled: async () => true,
      getStudioPublicSettings: async () => {
        const row = await prisma.studioSettings.findUniqueOrThrow({
          where: { id: "default" },
        });
        return {
          studioName: row.studioName,
          phone: row.phone,
          email: row.email,
          address: row.address,
          vkUrl: row.vkUrl,
          maxUrl: row.maxUrl,
          workingHoursText: row.workingHoursText,
          privacyUrl: row.privacyUrl,
          termsUrl: row.termsUrl,
          consentUrl: row.consentUrl,
          offerUrl: row.offerUrl,
          isOnlineBookingEnabled: row.isOnlineBookingEnabled,
          isGameEnabled: row.isGameEnabled,
          isPromotionsEnabled: row.isPromotionsEnabled,
          cookieBannerText: row.cookieBannerText,
          cookieDetailsUrl: row.cookieDetailsUrl,
        };
      },
      resolveBookingModes: async (serviceIds, _runtime, options) => {
        // Delegate to real BookingService for MANAGER_ONLY proof.
        const { resolveServiceBookingModes } = await import(
          "../src/services/BookingService"
        );
        return resolveServiceBookingModes(
          serviceIds,
          {
            db: prisma,
            resolveTiming: async () => ({
              durationMinutes: 60,
              breakAfterMinutes: 0,
            }),
            isStudioOnlineBookingEnabled: async () => true,
          },
          options,
        );
      },
      now: () => new Date("2026-08-29T15:00:00.000Z"),
    });

    assert.equal(first.schemaVersion, 1);
    assert.equal(first.studio.isOnlineBookingEnabled, true);
    assert.match(first.studio.name, new RegExp(runId));

    const online = first.services.find((s) => s.id === serviceOnlineId);
    const manager = first.services.find((s) => s.id === serviceManagerId);
    const inactive = first.services.find((s) => s.id === serviceInactiveId);
    assert.ok(online, "online service present");
    assert.ok(manager, "manager-only service present");
    assert.ok(inactive, "inactive service present");

    const onlineDb = await prisma.service.findUniqueOrThrow({
      where: { id: serviceOnlineId },
    });
    const managerDb = await prisma.service.findUniqueOrThrow({
      where: { id: serviceManagerId },
    });

    assert.equal(online.priceFrom, onlineDb.priceFrom!.toString());
    assert.equal(online.priceTo, onlineDb.priceTo!.toString());
    assert.equal(online.durationMinutes, 60);
    assert.equal(online.durationMinutes, onlineDb.durationMinutes);
    assert.equal(online.bookingMode, "ONLINE");
    assert.equal(online.isActive, true);

    assert.equal(manager.priceFrom, managerDb.priceFrom!.toString());
    assert.equal(manager.bookingMode, "MANAGER_ONLY");
    assert.equal(manager.isOnlineBookingEnabled, false);

    assert.equal(inactive.isActive, false);
    assert.equal(inactive.bookingMode, "MANAGER_ONLY");

    // Deterministic ordering: sortOrder 1 manager, 2 online, 3 inactive
    const ids = first.services
      .filter((s) =>
        [serviceOnlineId, serviceManagerId, serviceInactiveId].includes(s.id),
      )
      .map((s) => s.id);
    assert.deepEqual(ids, [serviceManagerId, serviceOnlineId, serviceInactiveId]);

    const linked = first.masters.find((m) => m.id === masterLinkedId);
    const unlinked = first.masters.find((m) => m.id === masterUnlinkedId);
    assert.ok(linked);
    assert.ok(unlinked);
    assert.deepEqual(linked.serviceIds, [serviceOnlineId]);
    assert.deepEqual(
      unlinked.serviceIds,
      [],
      "must not fabricate master↔service linkage",
    );

    assert.equal(
      "slots" in first ||
        "availableDays" in first ||
        "availability" in first ||
        "promotions" in first ||
        "gifts" in first,
      false,
    );

    // Change DB price — next read must change immediately WITHOUT publish.
    await prisma.service.update({
      where: { id: serviceOnlineId },
      data: { priceFrom: "2750.00", priceTo: "2750.00" },
    });

    const second = await buildBotLiveFactsPayload({
      db: prisma,
      resolveTiming: async () => ({
        durationMinutes: 60,
        breakAfterMinutes: 0,
      }),
      isStudioOnlineBookingEnabled: async () => true,
      getStudioPublicSettings: async () => {
        const row = await prisma.studioSettings.findUniqueOrThrow({
          where: { id: "default" },
        });
        return {
          studioName: row.studioName,
          phone: row.phone,
          email: row.email,
          address: row.address,
          vkUrl: row.vkUrl,
          maxUrl: row.maxUrl,
          workingHoursText: row.workingHoursText,
          privacyUrl: row.privacyUrl,
          termsUrl: row.termsUrl,
          consentUrl: row.consentUrl,
          offerUrl: row.offerUrl,
          isOnlineBookingEnabled: row.isOnlineBookingEnabled,
          isGameEnabled: row.isGameEnabled,
          isPromotionsEnabled: row.isPromotionsEnabled,
          cookieBannerText: row.cookieBannerText,
          cookieDetailsUrl: row.cookieDetailsUrl,
        };
      },
      resolveBookingModes: async (serviceIds, _runtime, options) => {
        const { resolveServiceBookingModes } = await import(
          "../src/services/BookingService"
        );
        return resolveServiceBookingModes(
          serviceIds,
          {
            db: prisma,
            resolveTiming: async () => ({
              durationMinutes: 60,
              breakAfterMinutes: 0,
            }),
            isStudioOnlineBookingEnabled: async () => true,
          },
          options,
        );
      },
      now: () => new Date("2026-08-29T15:01:00.000Z"),
    });

    const onlineAfter = second.services.find((s) => s.id === serviceOnlineId);
    assert.ok(onlineAfter);
    const onlineDbAfter = await prisma.service.findUniqueOrThrow({
      where: { id: serviceOnlineId },
    });
    assert.equal(onlineAfter.priceFrom, onlineDbAfter.priceFrom!.toString());
    assert.equal(onlineAfter.priceTo, onlineDbAfter.priceTo!.toString());
    assert.notEqual(online.priceFrom, onlineAfter.priceFrom);

    const kbCountAfter = await prisma.botKnowledgePublication.count();
    const settingsPubAfter = await prisma.botSettingsPublication.count();
    assert.equal(kbCountAfter, kbCountBefore, "must not create KB publications");
    assert.equal(
      settingsPubAfter,
      settingsPubBefore,
      "must not create bot settings publications",
    );

    // Fail-closed: core SoT query failure propagates (route maps to 5xx).
    await assert.rejects(
      () =>
        buildBotLiveFactsPayload({
          db: {
            service: {
              findMany: async () => {
                throw new Error("forced-sot-failure");
              },
            },
            master: { findMany: async () => [] },
          } as never,
          resolveTiming: async () => null,
          isStudioOnlineBookingEnabled: async () => true,
          getStudioPublicSettings: async () => ({
            studioName: "X",
            phone: "1",
            email: "a@b.c",
            address: "y",
            vkUrl: "",
            maxUrl: "",
            workingHoursText: "",
            privacyUrl: "/privacy",
            termsUrl: "/terms",
            consentUrl: "/consent",
            offerUrl: "/offer",
            isOnlineBookingEnabled: true,
            isGameEnabled: false,
            isPromotionsEnabled: false,
            cookieBannerText: "",
            cookieDetailsUrl: "/cookies",
          }),
          resolveBookingModes: async () => new Map(),
          now: () => new Date(),
        }),
      /forced-sot-failure/,
    );

    console.log("security-bot-live-facts-db-check: OK");
  } finally {
    await prisma.masterService
      .deleteMany({
        where: { masterId: { in: [masterLinkedId, masterUnlinkedId] } },
      })
      .catch(() => undefined);
    await prisma.service
      .deleteMany({
        where: {
          id: { in: [serviceOnlineId, serviceManagerId, serviceInactiveId] },
        },
      })
      .catch(() => undefined);
    await prisma.master
      .deleteMany({ where: { id: { in: [masterLinkedId, masterUnlinkedId] } } })
      .catch(() => undefined);
    await prisma.serviceCategory
      .deleteMany({ where: { id: categoryId } })
      .catch(() => undefined);
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
