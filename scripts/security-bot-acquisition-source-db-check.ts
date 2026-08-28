/**
 * A2.3b2 acquisition-source feed PG proofs (required / --require-postgres).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AppointmentCreatorKind,
  AppointmentSource,
  AppointmentStatus,
  BookingRequestStatus,
  BookingRequestType,
  PrismaClient,
} from "@prisma/client";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../src/lib/security/opaque-token";
import {
  startEphemeralPostgres,
  runPrismaMigrateDeploy,
  type EphemeralPostgres,
} from "./lib/ephemeral-postgres";

const REQUIRE_POSTGRES =
  process.argv.includes("--require-postgres") ||
  process.env.SECURITY_REQUIRE_PG === "1";

function failRequired(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBlockedOnHolderLock(input: {
  prisma: PrismaClient;
  blockedPid: number;
  holderPid: number;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + (input.timeoutMs ?? 8000);
  while (Date.now() < deadline) {
    const rows = await input.prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks AS blocked_lock
        JOIN pg_locks AS holder_lock
          ON holder_lock.locktype = blocked_lock.locktype
         AND holder_lock.database IS NOT DISTINCT FROM blocked_lock.database
         AND holder_lock.relation IS NOT DISTINCT FROM blocked_lock.relation
         AND holder_lock.page IS NOT DISTINCT FROM blocked_lock.page
         AND holder_lock.tuple IS NOT DISTINCT FROM blocked_lock.tuple
         AND holder_lock.virtualxid IS NOT DISTINCT FROM blocked_lock.virtualxid
         AND holder_lock.transactionid IS NOT DISTINCT FROM blocked_lock.transactionid
         AND holder_lock.classid IS NOT DISTINCT FROM blocked_lock.classid
         AND holder_lock.objid IS NOT DISTINCT FROM blocked_lock.objid
         AND holder_lock.objsubid IS NOT DISTINCT FROM blocked_lock.objsubid
         AND holder_lock.pid = ${input.holderPid}
         AND holder_lock.granted = true
        JOIN pg_stat_activity AS blocked_activity
          ON blocked_activity.pid = blocked_lock.pid
        WHERE blocked_lock.pid = ${input.blockedPid}
          AND blocked_lock.granted = false
          AND blocked_activity.wait_event_type = 'Lock'
      ) AS blocked
    `;
    if (rows[0]?.blocked) {
      return;
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for blocked session on singleton lock");
}

async function main(): Promise<void> {
  if (!REQUIRE_POSTGRES) {
    failRequired(
      "acquisition-source DB suite requires --require-postgres (no SKIPPED)",
    );
  }

  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "a23b2-acq-src-pg",
      databaseName: "a23b2_acquisition_source_test",
      password: "a23b2-acq-src-test",
    });
  } catch (error) {
    failRequired(
      `ephemeral postgres failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!ephemeral) {
    failRequired("ephemeral postgres unavailable (docker required)");
  }

  const databaseUrl = ephemeral.databaseUrl;
  process.env.DATABASE_URL = databaseUrl;

  try {
    runPrismaMigrateDeploy(databaseUrl);
  } catch (error) {
    await ephemeral.cleanup();
    failRequired(
      `fresh migrate deploy failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const indexRows = await new PrismaClient().$queryRaw<
    Array<{ indexname: string }>
  >`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'acquisition_evidence'
      AND indexname = 'acquisition_evidence_feed_order_idx'
  `;
  const clockRows = await new PrismaClient().$queryRaw<
    Array<{ id: string }>
  >`
    SELECT "id"
    FROM "acquisition_evidence_feed_order_clock"
    WHERE "id" = 'singleton'
  `;
  await new PrismaClient().$disconnect().catch(() => undefined);
  if (indexRows.length !== 1) {
    await ephemeral.cleanup();
    failRequired("acquisition_evidence_feed_order_idx missing after migrate");
  }
  if (clockRows.length !== 1) {
    await ephemeral.cleanup();
    failRequired("acquisition_evidence_feed_order_clock singleton missing");
  }

  const { prisma } = await import("../src/lib/db");
  const {
    feedBotAcquisitionSourceEvidence,
    getBotAcquisitionSourceContext,
  } = await import("../src/services/BotAcquisitionSourceService");
  const {
    claimAcquisitionEvidenceForAppointment,
    claimAcquisitionEvidenceForBookingRequest,
    mintAcquisitionLink,
  } = await import("../src/services/AcquisitionAttributionService");

  const runId = randomUUID().slice(0, 8);

  async function issueUnconsumedEvidence(input: {
    linkId: string;
    sourceKey: string;
    id?: string;
    token?: string;
  }) {
    const token = input.token ?? generateOpaqueToken();
    return prisma.acquisitionEvidence.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        tokenHash: hashOpaqueToken(token),
        sourceKey: input.sourceKey,
        acquisitionLinkId: input.linkId,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    }).then((row) => ({ evidenceId: row.id, token }));
  }

  try {
    const category = await prisma.serviceCategory.create({
      data: {
        name: `A23b2 Cat ${runId}`,
        sortOrder: 0,
        isActive: true,
        isPublic: true,
      },
    });
    const master = await prisma.master.create({
      data: {
        internalName: `a23b2-mst-${runId}`,
        publicName: `A23b2 Master ${runId}`,
        slotMinutes: 30,
        workStart: "09:00",
        workEnd: "21:00",
        breakAfterMinutes: 0,
        usesDefaultWorkHours: false,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        sortOrder: 0,
      },
    });
    const service = await prisma.service.create({
      data: {
        categoryId: category.id,
        internalName: `a23b2-svc-${runId}`,
        publicName: `A23b2 Service ${runId}`,
        durationMinutes: 60,
        breakAfterMinutes: 0,
        isActive: true,
        isPublic: true,
        isOnlineBookingEnabled: true,
        sortOrder: 0,
      },
    });

    const minted = await mintAcquisitionLink({ sourceKey: "YANDEX" });
    const link = await prisma.acquisitionLink.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(minted.token) },
    });

    const appt = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-08-29T10:00:00.000Z"),
        endsAt: new Date("2026-08-29T11:00:00.000Z"),
        clientName: "Appt Client",
        clientPhone: "+79001112233",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.SELF_SERVICE,
      },
    });

    const apptIssued = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "YANDEX",
    });
    await claimAcquisitionEvidenceForAppointment(
      prisma,
      apptIssued.token,
      appt.id,
    );
    const apptEvidence = await prisma.acquisitionEvidence.findUniqueOrThrow({
      where: { id: apptIssued.evidenceId },
      select: { id: true, feedOrder: true },
    });
    assert.ok(apptEvidence.feedOrder !== null);

    const br = await prisma.bookingRequest.create({
      data: {
        clientName: "BR Client",
        clientPhone: "+79004445566",
        type: BookingRequestType.CONSULTATION_REQUEST,
        status: BookingRequestStatus.NEW,
      },
    });

    const brIssued = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "VK_CONTENT",
    });
    await claimAcquisitionEvidenceForBookingRequest(
      prisma,
      brIssued.token,
      br.id,
    );
    const brEvidence = await prisma.acquisitionEvidence.findUniqueOrThrow({
      where: { id: brIssued.evidenceId },
      select: { id: true, feedOrder: true },
    });
    assert.ok(brEvidence.feedOrder !== null);

    // Unconsumed evidence — must not appear in feed.
    await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "TWO_GIS",
    });

    // Marker-only site attribution without evidence binding.
    const markerOnlyAppt = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-08-30T10:00:00.000Z"),
        endsAt: new Date("2026-08-30T11:00:00.000Z"),
        clientName: "Marker Only",
        clientPhone: "+79007778899",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.SELF_SERVICE,
        siteAttribution: {
          create: {
            sourceMarker: "VK_ADS",
            utmSource: "vk",
          },
        },
      },
    });
    assert.ok(markerOnlyAppt.id);

    const feedAll = await feedBotAcquisitionSourceEvidence({ limit: 50 });
    assert.equal(feedAll.ok, true);
    if (!feedAll.ok) {
      throw new Error("feed failed");
    }
    const ids = new Set(feedAll.body.items.map((i) => i.evidenceId));
    assert.ok(ids.has(apptEvidence.id));
    assert.ok(ids.has(brEvidence.id));
    assert.equal(
      feedAll.body.items.some((i) => i.ownerId === markerOnlyAppt.id),
      false,
    );

    const apptItem = feedAll.body.items.find(
      (i) => i.evidenceId === apptEvidence.id,
    );
    assert.ok(apptItem);
    assert.equal(apptItem.ownerKind, "APPOINTMENT");
    assert.equal(apptItem.sourceKey, "YANDEX");
    assert.ok(apptItem.feedOrder);

    const ctxAppt = await getBotAcquisitionSourceContext({
      evidenceId: apptEvidence.id,
      ownerKind: "APPOINTMENT",
      ownerId: appt.id,
    });
    assert.equal(ctxAppt.ok, true);
    if (ctxAppt.ok) {
      assert.equal(ctxAppt.body.sourceKey, "YANDEX");
      assert.equal(ctxAppt.body.phoneE164, "+79001112233");
    }

    const ctxWrongOwner = await getBotAcquisitionSourceContext({
      evidenceId: apptEvidence.id,
      ownerKind: "BOOKING_REQUEST",
      ownerId: br.id,
    });
    assert.equal(ctxWrongOwner.ok, false);
    if (!ctxWrongOwner.ok) {
      assert.equal(ctxWrongOwner.code, "NOT_FOUND");
    }

    const ctxMarkerOnly = await getBotAcquisitionSourceContext({
      evidenceId: apptEvidence.id,
      ownerKind: "APPOINTMENT",
      ownerId: markerOnlyAppt.id,
    });
    assert.equal(ctxMarkerOnly.ok, false);

    // Equal feedOrder tie-break pagination on evidenceId.
    const tieFeedOrder = 99999n;
    const tieApptA = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-08-31T10:00:00.000Z"),
        endsAt: new Date("2026-08-31T11:00:00.000Z"),
        clientName: "Tie A",
        clientPhone: "+79001110001",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const tieApptB = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-08-31T12:00:00.000Z"),
        endsAt: new Date("2026-08-31T13:00:00.000Z"),
        clientName: "Tie B",
        clientPhone: "+79001110002",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const tieA = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "VK_ADS",
      id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    });
    const tieB = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "TWO_GIS",
      id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    });
    await prisma.$executeRaw`
      UPDATE "acquisition_evidence"
      SET
        "consumed_at" = statement_timestamp(),
        "feed_order" = ${tieFeedOrder},
        "appointment_id" = ${tieApptA.id}::uuid
      WHERE "id" = ${tieA.evidenceId}::uuid
        AND "consumed_at" IS NULL
    `;
    await prisma.$executeRaw`
      UPDATE "acquisition_evidence"
      SET
        "consumed_at" = statement_timestamp(),
        "feed_order" = ${tieFeedOrder},
        "appointment_id" = ${tieApptB.id}::uuid
      WHERE "id" = ${tieB.evidenceId}::uuid
        AND "consumed_at" IS NULL
    `;
    await prisma.acquisitionEvidenceFeedOrderClock.update({
      where: { id: "singleton" },
      data: { lastOrder: tieFeedOrder },
    });

    const page1 = await feedBotAcquisitionSourceEvidence({
      limit: 100,
      cursor: {
        feedOrder: tieFeedOrder.toString(),
        evidenceId: "00000000-0000-4000-8000-000000000000",
      },
    });
    assert.equal(page1.ok, true);
    if (!page1.ok) {
      throw new Error("page1 failed");
    }
    const tieIds = page1.body.items
      .filter(
        (i) => i.evidenceId === tieA.evidenceId || i.evidenceId === tieB.evidenceId,
      )
      .map((i) => i.evidenceId);
    assert.deepEqual(tieIds, [tieA.evidenceId, tieB.evidenceId]);

    // Late-commit feed race: singleton counter serializes feedOrder assignment.
    const raceApptA = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-09-01T10:00:00.000Z"),
        endsAt: new Date("2026-09-01T11:00:00.000Z"),
        clientName: "Race A",
        clientPhone: "+79002220001",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const raceApptB = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-09-01T12:00:00.000Z"),
        endsAt: new Date("2026-09-01T13:00:00.000Z"),
        clientName: "Race B",
        clientPhone: "+79002220002",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const raceIssuedA = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "VK_ADS",
    });
    const raceIssuedB = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "TWO_GIS",
    });

    const aClaimed = deferred();
    const aRelease = deferred();
    const bStarted = deferred();
    let raceFeedOrderA: bigint | null = null;
    let raceFeedOrderB: bigint | null = null;
    let txAPid = 0;
    let txBPid = 0;

    const txA = prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;
      txAPid = pid;
      const claimed = await claimAcquisitionEvidenceForAppointment(
        tx,
        raceIssuedA.token,
        raceApptA.id,
      );
      assert.ok(claimed);
      const row = await tx.acquisitionEvidence.findUniqueOrThrow({
        where: { id: raceIssuedA.evidenceId },
        select: { feedOrder: true },
      });
      raceFeedOrderA = row.feedOrder;
      assert.ok(raceFeedOrderA !== null);
      aClaimed.resolve();
      await aRelease.promise;
    });

    await aClaimed.promise;

    let txBSettled = false;
    const txB = prisma
      .$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        txBPid = pid;
        bStarted.resolve();
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          raceIssuedB.token,
          raceApptB.id,
        );
        assert.ok(claimed);
        const row = await tx.acquisitionEvidence.findUniqueOrThrow({
          where: { id: raceIssuedB.evidenceId },
          select: { feedOrder: true },
        });
        raceFeedOrderB = row.feedOrder;
        assert.ok(raceFeedOrderB !== null);
      })
      .finally(() => {
        txBSettled = true;
      });

    await bStarted.promise;
    await waitForBlockedOnHolderLock({
      prisma,
      blockedPid: txBPid,
      holderPid: txAPid,
    });
    assert.equal(
      txBSettled,
      false,
      "concurrent claim B must wait on singleton row lock",
    );

    const feedWhileAHeld = await feedBotAcquisitionSourceEvidence({ limit: 200 });
    assert.equal(feedWhileAHeld.ok, true);
    if (!feedWhileAHeld.ok) {
      throw new Error("feedWhileAHeld failed");
    }
    assert.equal(
      feedWhileAHeld.body.items.some((i) => i.evidenceId === raceIssuedA.evidenceId),
      false,
      "uncommitted A must not appear in feed",
    );
    assert.equal(
      feedWhileAHeld.body.items.some((i) => i.evidenceId === raceIssuedB.evidenceId),
      false,
      "B must not appear before clock lock releases",
    );

    aRelease.resolve();
    await txA;
    await txB;
    assert.ok(raceFeedOrderA !== null && raceFeedOrderB !== null);
    assert.ok(
      raceFeedOrderB > raceFeedOrderA,
      "feedOrder(B) must be strictly greater than feedOrder(A)",
    );

    const seen = new Set<string>();
    let cursor: { feedOrder: string; evidenceId: string } | undefined;
    for (;;) {
      const page = await feedBotAcquisitionSourceEvidence({
        limit: 5,
        cursor,
      });
      assert.equal(page.ok, true);
      if (!page.ok) {
        throw new Error("race pagination failed");
      }
      for (const item of page.body.items) {
        assert.equal(seen.has(item.evidenceId), false, "no duplicate feed rows");
        seen.add(item.evidenceId);
      }
      if (!page.body.nextCursor) {
        break;
      }
      cursor = page.body.nextCursor;
    }
    assert.ok(seen.has(raceIssuedA.evidenceId));
    assert.ok(seen.has(raceIssuedB.evidenceId));

    // Rollback while B waits: committed order stays monotonic without gap for B.
    const kClock = await prisma.acquisitionEvidenceFeedOrderClock.findUniqueOrThrow(
      { where: { id: "singleton" } },
    );
    const kCommitted = kClock.lastOrder;

    const rollbackRaceApptA = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-09-03T10:00:00.000Z"),
        endsAt: new Date("2026-09-03T11:00:00.000Z"),
        clientName: "Rb Race A",
        clientPhone: "+79003330010",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const rollbackRaceApptB = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-09-03T12:00:00.000Z"),
        endsAt: new Date("2026-09-03T13:00:00.000Z"),
        clientName: "Rb Race B",
        clientPhone: "+79003330011",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const rbIssuedA = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "VK_ADS",
    });
    const rbIssuedB = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "TWO_GIS",
    });

    const rbAClaimed = deferred();
    const rbBStarted = deferred();
    const rbBWaiting = deferred();
    let rbAPid = 0;
    let rbBPid = 0;
    let rbFeedOrderB: bigint | null = null;

    const rbTxA = prisma
      .$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        rbAPid = pid;
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          rbIssuedA.token,
          rollbackRaceApptA.id,
        );
        assert.ok(claimed);
        rbAClaimed.resolve();
        await rbBWaiting.promise;
        throw new Error("FORCE_ROLLBACK_A");
      })
      .catch(() => undefined);

    await rbAClaimed.promise;

    const rbTxB = prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid
      `;
      rbBPid = pid;
      rbBStarted.resolve();
      const claimed = await claimAcquisitionEvidenceForAppointment(
        tx,
        rbIssuedB.token,
        rollbackRaceApptB.id,
      );
      assert.ok(claimed);
      const row = await tx.acquisitionEvidence.findUniqueOrThrow({
        where: { id: rbIssuedB.evidenceId },
        select: { feedOrder: true },
      });
      rbFeedOrderB = row.feedOrder;
      assert.ok(rbFeedOrderB !== null);
    });

    await rbBStarted.promise;
    await waitForBlockedOnHolderLock({
      prisma,
      blockedPid: rbBPid,
      holderPid: rbAPid,
    });
    rbBWaiting.resolve();
    await rbTxA;
    await rbTxB;

    const rbRowA = await prisma.acquisitionEvidence.findUniqueOrThrow({
      where: { id: rbIssuedA.evidenceId },
      select: { consumedAt: true, feedOrder: true },
    });
    assert.equal(rbRowA.consumedAt, null);
    assert.equal(rbRowA.feedOrder, null);
    assert.ok(rbFeedOrderB !== null);
    assert.ok(
      rbFeedOrderB > kCommitted,
      "feedOrder(B) must advance past prior committed clock K",
    );
    const kAfterRollback = await prisma.acquisitionEvidenceFeedOrderClock.findUniqueOrThrow(
      { where: { id: "singleton" } },
    );
    assert.ok(kAfterRollback.lastOrder >= rbFeedOrderB);

    // Simple rollback: failed claim must not advance durable feed order for retry.
    const rollbackIssued = await issueUnconsumedEvidence({
      linkId: link.id,
      sourceKey: "YANDEX",
    });
    const rollbackAppt = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2026-09-02T10:00:00.000Z"),
        endsAt: new Date("2026-09-02T11:00:00.000Z"),
        clientName: "Rollback",
        clientPhone: "+79003330001",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: AppointmentCreatorKind.MANAGER,
      },
    });
    const clockBeforeRollback = await prisma.acquisitionEvidenceFeedOrderClock.findUniqueOrThrow(
      { where: { id: "singleton" } },
    );
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          rollbackIssued.token,
          rollbackAppt.id,
        );
        assert.ok(claimed);
        throw new Error("FORCE_ROLLBACK");
      }),
    );
    const rollbackRow = await prisma.acquisitionEvidence.findUniqueOrThrow({
      where: { id: rollbackIssued.evidenceId },
      select: { consumedAt: true, feedOrder: true },
    });
    assert.equal(rollbackRow.consumedAt, null);
    assert.equal(rollbackRow.feedOrder, null);
    const clockAfterRollback = await prisma.acquisitionEvidenceFeedOrderClock.findUniqueOrThrow(
      { where: { id: "singleton" } },
    );
    assert.equal(
      clockAfterRollback.lastOrder,
      clockBeforeRollback.lastOrder,
      "clock advancement rolls back with failed claim transaction",
    );
    await claimAcquisitionEvidenceForAppointment(
      prisma,
      rollbackIssued.token,
      rollbackAppt.id,
    );
    const rollbackCommitted = await prisma.acquisitionEvidence.findUniqueOrThrow({
      where: { id: rollbackIssued.evidenceId },
      select: { feedOrder: true },
    });
    assert.ok(rollbackCommitted.feedOrder !== null);

    console.log("PASSED: consumed-appointment");
    console.log("PASSED: consumed-booking-request");
    console.log("PASSED: unconsumed-absent");
    console.log("PASSED: marker-only-absent");
    console.log("PASSED: wrong-owner-not-found");
    console.log("PASSED: context-source-from-evidence");
    console.log("PASSED: equal-feedOrder-pagination");
    console.log("PASSED: late-commit-feed-race-lock-proof");
    console.log("PASSED: rollback-a-while-b-waits");
    console.log("PASSED: rollback-clock-safe");
    console.log("PASSED: fresh-migration-index");
    console.log("security-bot-acquisition-source-db-check: OK");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await ephemeral.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
