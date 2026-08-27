/**
 * A2.2 booking-method feed PG proofs (optional / --require-postgres).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AppointmentCreatorKind,
  AppointmentSource,
  AppointmentStatus,
  PrismaClient,
} from "@prisma/client";
import {
  feedBotBookingMethodAppointments,
  getBotBookingMethodAppointmentContext,
} from "../src/services/BotBookingMethodService";
import { assertDisposableBotBookingTestDatabase } from "./lib/bot-booking-create-test-db-guard";

const REQUIRE_POSTGRES =
  process.argv.includes("--require-postgres") ||
  process.env.SECURITY_REQUIRE_PG === "1";

function skipOrFail(message: string): never {
  if (REQUIRE_POSTGRES) {
    console.error(`FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`SKIPPED: ${message}`);
  process.exit(0);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    assertDisposableBotBookingTestDatabase(databaseUrl);
  } catch (error) {
    skipOrFail(
      `test-database-guard (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    skipOrFail(
      `postgres unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const runId = randomUUID().slice(0, 8);
  const category = await prisma.serviceCategory.create({
    data: {
      name: `A22 Cat ${runId}`,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
    },
  });
  const master = await prisma.master.create({
    data: {
      internalName: `a22-mst-${runId}`,
      publicName: `A22 Feed Master ${runId}`,
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
      internalName: `a22-svc-${runId}`,
      publicName: `A22 Feed Service ${runId}`,
      durationMinutes: 60,
      breakAfterMinutes: 0,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 0,
    },
  });

  const base = new Date("2026-08-26T10:00:00.000Z");
  const mk = async (
    kind: AppointmentCreatorKind | null,
    offsetMs: number,
    phone = "+79001110001",
  ) => {
    const starts = new Date(base.getTime() + offsetMs);
    return prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: starts,
        endsAt: new Date(starts.getTime() + 60 * 60 * 1000),
        clientName: "A22 Client",
        clientPhone: phone,
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.ONLINE,
        creatorKind: kind,
        createdAt: new Date(base.getTime() + offsetMs),
      },
    });
  };

  try {
    const self = await mk(AppointmentCreatorKind.SELF_SERVICE, 1000);
    const manager = await mk(AppointmentCreatorKind.MANAGER, 2000);
    const masterAppt = await mk(AppointmentCreatorKind.MASTER, 3000);
    const teya = await mk(AppointmentCreatorKind.TEYA, 4000);
    const legacy = await mk(null, 5000);

    // Same-timestamp tie-break: two rows, id order must not lose either.
    const tieAt = new Date(base.getTime() + 6000);
    const tieA = await prisma.appointment.create({
      data: {
        id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date(tieAt.getTime() + 60_000),
        endsAt: new Date(tieAt.getTime() + 120_000),
        clientName: "Tie A",
        clientPhone: "+79001110002",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.INTERNAL,
        creatorKind: AppointmentCreatorKind.MANAGER,
        createdAt: tieAt,
      },
    });
    const tieB = await prisma.appointment.create({
      data: {
        id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date(tieAt.getTime() + 180_000),
        endsAt: new Date(tieAt.getTime() + 240_000),
        clientName: "Tie B",
        clientPhone: "+79001110003",
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.INTERNAL,
        creatorKind: AppointmentCreatorKind.MANAGER,
        createdAt: tieAt,
      },
    });

    const page1 = await feedBotBookingMethodAppointments({ limit: 2 });
    assert.equal(page1.ok, true);
    if (!page1.ok) throw new Error("page1 failed");
    assert.equal(page1.body.items.length, 2);
    assert.equal(page1.body.items[0]?.appointmentId, self.id);
    assert.equal(page1.body.items[0]?.creatorKind, "SELF_SERVICE");
    assert.equal(page1.body.items[1]?.appointmentId, manager.id);
    assert.ok(page1.body.nextCursor);

    const page2 = await feedBotBookingMethodAppointments({
      limit: 10,
      cursor: page1.body.nextCursor!,
    });
    assert.equal(page2.ok, true);
    if (!page2.ok) throw new Error("page2 failed");
    const ids = page2.body.items.map((i) => i.appointmentId);
    assert.ok(ids.includes(masterAppt.id));
    assert.ok(ids.includes(tieA.id));
    assert.ok(ids.includes(tieB.id));
    assert.ok(!ids.includes(teya.id), "TEYA must be excluded");
    assert.ok(!ids.includes(legacy.id), "NULL creator_kind must be excluded");
    assert.ok(
      ids.indexOf(tieA.id) < ids.indexOf(tieB.id),
      "same createdAt must order by id asc",
    );

    const ctx = await getBotBookingMethodAppointmentContext({
      appointmentId: self.id,
    });
    assert.equal(ctx.ok, true);
    if (!ctx.ok) throw new Error("ctx failed");
    assert.equal(ctx.body.creatorKind, "SELF_SERVICE");
    assert.equal(ctx.body.phoneE164, "+79001110001");

    const ctxTeya = await getBotBookingMethodAppointmentContext({
      appointmentId: teya.id,
    });
    assert.equal(ctxTeya.ok, false);

    console.log("PASSED: feed-kinds-and-cursor");
    console.log("PASSED: context-read");
    console.log("PASSED: teya-null-excluded");
    console.log("security-bot-booking-method-db-check: OK");
  } finally {
    await prisma.appointment.deleteMany({
      where: { masterId: master.id },
    });
    await prisma.service.delete({ where: { id: service.id } }).catch(() => undefined);
    await prisma.serviceCategory.delete({ where: { id: category.id } }).catch(() => undefined);
    await prisma.master.delete({ where: { id: master.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
