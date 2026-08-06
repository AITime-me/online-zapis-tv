/**
 * Self-contained PostgreSQL fixtures for CURSOR-24 bot booking create races.
 * Mutations require assertDisposableBotBookingTestDatabase (callers).
 * Cleanup is scoped to this runId only.
 */
import { randomUUID } from "node:crypto";
import {
  LegalDocumentVersionStatus,
  type PrismaClient,
} from "@prisma/client";
import { buildBotSlotId } from "../../src/lib/booking/bot-slot-id";
import {
  addDaysToDateKey,
  formatStudioDateKey,
  getStudioNow,
} from "../../src/lib/datetime/date-layer";
import { hashLegalDocumentContent } from "../../src/lib/legal-document/content-hash";
import {
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
} from "../../src/lib/legal-document/defaults";

export const C24_TEST_PREFIX = "c24test-";

export type BotBookingCreatePgFixture = {
  runId: string;
  categoryId: string;
  serviceId: string;
  masterId: string;
  dateKey: string;
  startTime: string;
  slotId: string;
  overlapStartTime: string;
  overlapSlotId: string;
  durationMinutes: number;
  phoneSeed: string;
  nameTag: string;
  cleanup: () => Promise<void>;
};

function uniquePhone(runId: string, n: number): string {
  const digits = `${Date.now().toString().slice(-5)}${n}${runId.replace(/\D/g, "").slice(0, 1)}`.slice(
    0,
    7,
  );
  return `+7900${digits.padStart(7, "0").slice(0, 7)}`;
}

export function nextFixturePhone(runId: string, seq: number): string {
  return uniquePhone(runId, seq);
}

export function fixtureClientName(
  runId: string,
  label: string,
): string {
  return `${C24_TEST_PREFIX}${runId} ${label}`;
}

async function ensureStudioOnlineBooking(
  prisma: PrismaClient,
): Promise<{ previousEnabled: boolean | null }> {
  const existing = await prisma.studioSettings.findUnique({
    where: { id: "default" },
    select: { isOnlineBookingEnabled: true },
  });
  await prisma.studioSettings.upsert({
    where: { id: "default" },
    update: { isOnlineBookingEnabled: true },
    create: {
      id: "default",
      isOnlineBookingEnabled: true,
    },
  });
  return {
    previousEnabled: existing ? existing.isOnlineBookingEnabled : null,
  };
}

async function publishRequiredLegalDocuments(
  prisma: PrismaClient,
): Promise<void> {
  // Disposable test DB only — legal rows may remain; DB is destroyed by CI.
  for (const document of LEGAL_DOCUMENT_SEED_METADATA) {
    if (
      !REQUIRED_PUBLISHED_LEGAL_SLUGS.includes(
        document.slug as (typeof REQUIRED_PUBLISHED_LEGAL_SLUGS)[number],
      )
    ) {
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
    if (created.currentPublishedVersionId) {
      continue;
    }
    const latest = await prisma.legalDocumentVersion.findFirst({
      where: { documentId: created.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    const content = `${C24_TEST_PREFIX}published ${document.slug}`;
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

export async function createBotBookingCreatePgFixture(
  prisma: PrismaClient,
): Promise<BotBookingCreatePgFixture> {
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const nameTag = `${C24_TEST_PREFIX}${runId}`;
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const masterId = randomUUID();
  const durationMinutes = 60;
  const startTime = "14:00";
  const overlapStartTime = "14:30";

  const studio = await ensureStudioOnlineBooking(prisma);
  await publishRequiredLegalDocuments(prisma);

  await prisma.serviceCategory.create({
    data: {
      id: categoryId,
      name: `${nameTag}-cat`,
      isActive: true,
      isPublic: true,
      sortOrder: 0,
    },
  });

  await prisma.service.create({
    data: {
      id: serviceId,
      categoryId,
      internalName: `${nameTag}-svc`,
      publicName: `${nameTag}-svc`,
      durationMinutes,
      breakAfterMinutes: 0,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 0,
    },
  });

  await prisma.master.create({
    data: {
      id: masterId,
      internalName: `${nameTag}-mst`,
      publicName: `${nameTag}-mst`,
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

  await prisma.masterService.create({
    data: {
      masterId,
      serviceId,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 0,
    },
  });

  const base = formatStudioDateKey(getStudioNow());
  const dateKey = addDaysToDateKey(base, 21);

  const slotId = buildBotSlotId({
    serviceId,
    masterId,
    dateKey,
    startTime,
  });
  const overlapSlotId = buildBotSlotId({
    serviceId,
    masterId,
    dateKey,
    startTime: overlapStartTime,
  });

  const cleanup = async () => {
    const appointments = await prisma.appointment.findMany({
      where: {
        OR: [
          { masterId },
          { serviceId },
          { clientName: { startsWith: nameTag } },
        ],
      },
      select: { id: true, clientId: true },
    });
    const appointmentIds = appointments.map((a) => a.id);
    const clientIds = [
      ...new Set(
        appointments
          .map((a) => a.clientId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];

    if (appointmentIds.length > 0) {
      await prisma.legalAcceptanceRecord.deleteMany({
        where: { appointmentId: { in: appointmentIds } },
      });
      await prisma.appointment.deleteMany({
        where: { id: { in: appointmentIds } },
      });
    }

    await prisma.client.deleteMany({
      where: {
        OR: [
          { id: { in: clientIds } },
          { fullName: { startsWith: nameTag } },
        ],
      },
    });

    await prisma.masterService.deleteMany({ where: { masterId, serviceId } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });

    if (studio.previousEnabled !== null) {
      await prisma.studioSettings.update({
        where: { id: "default" },
        data: { isOnlineBookingEnabled: studio.previousEnabled },
      });
    }
  };

  return {
    runId,
    categoryId,
    serviceId,
    masterId,
    dateKey,
    startTime,
    slotId,
    overlapStartTime,
    overlapSlotId,
    durationMinutes,
    phoneSeed: runId,
    nameTag,
    cleanup,
  };
}
