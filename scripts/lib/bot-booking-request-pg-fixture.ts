/**
 * PostgreSQL fixtures for BookingRequest bot book_from_request races.
 * Online flags are DISABLED — proves INTERNAL / request-only policy.
 * Mutations require assertDisposableBotBookingTestDatabase (callers).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  createBotBookingCreatePgFixture,
  fixtureClientName,
  nextFixturePhone,
  type BotBookingCreatePgFixture,
} from "./bot-booking-create-pg-fixture";

export const BR_TEST_PREFIX = "brtest-";

export type BotBookingRequestPgFixture = BotBookingCreatePgFixture & {
  /** BookingRequest used by success / race scenarios (MANAGER_REQUEST). */
  requestId: string;
  clientName: string;
  clientPhone: string;
};

async function disablePublicOnlineFlags(
  prisma: PrismaClient,
  fixture: BotBookingCreatePgFixture,
): Promise<void> {
  await prisma.studioSettings.upsert({
    where: { id: "default" },
    update: { isOnlineBookingEnabled: false },
    create: {
      id: "default",
      isOnlineBookingEnabled: false,
    },
  });
  await prisma.master.update({
    where: { id: fixture.masterId },
    data: { isOnlineBookingEnabled: false, isPublic: false },
  });
  await prisma.service.update({
    where: { id: fixture.serviceId },
    data: { isOnlineBookingEnabled: false, isPublic: false },
  });
  await prisma.masterService.update({
    where: {
      masterId_serviceId: {
        masterId: fixture.masterId,
        serviceId: fixture.serviceId,
      },
    },
    data: { isOnlineBookingEnabled: false, isPublic: false },
  });
}

export async function createBotBookingRequestPgFixture(
  prisma: PrismaClient,
): Promise<BotBookingRequestPgFixture> {
  const base = await createBotBookingCreatePgFixture(prisma);
  await disablePublicOnlineFlags(prisma, base);

  const clientPhone = nextFixturePhone(base.runId, 90);
  const clientName = fixtureClientName(base.runId, "br-client");
  const requestId = randomUUID();

  await prisma.bookingRequest.create({
    data: {
      id: requestId,
      clientName,
      clientPhone,
      masterId: base.masterId,
      serviceId: base.serviceId,
      status: "NEW",
      source: "ONLINE",
      type: "MANAGER_REQUEST",
    },
  });

  const baseCleanup = base.cleanup;
  const cleanup = async () => {
    await prisma.bookingRequest.deleteMany({
      where: {
        OR: [
          { id: requestId },
          { masterId: base.masterId },
          { clientName: { startsWith: base.nameTag } },
        ],
      },
    });
    await baseCleanup();
  };

  return {
    ...base,
    requestId,
    clientName,
    clientPhone,
    cleanup,
  };
}

export { fixtureClientName, nextFixturePhone };
