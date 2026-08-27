process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  LegalDocumentVersionStatus,
  PrismaClient,
} from "@prisma/client";
import { EMPTY_SITE_ATTRIBUTION } from "../src/lib/attribution/site-attribution";
import { assertDisposableBotBookingTestDatabase } from "./lib/bot-booking-create-test-db-guard";
import { hashLegalDocumentContent } from "../src/lib/legal-document/content-hash";
import {
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
} from "../src/lib/legal-document/defaults";
import {
  createAppointmentServiceRuntime,
  createOnlineAppointment,
} from "../src/services/AppointmentService";
import {
  BookingRequestPublicError,
  createBookingRequest,
} from "../src/services/BookingRequestService";
import { getBotBookingMethodAppointmentContext } from "../src/services/BotBookingMethodService";
import {
  feedBotBookingRequests,
  getBotBookingRequest,
} from "../src/services/BotBookingRequestService";

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

async function publishRequiredLegalDocuments(
  prisma: PrismaClient,
): Promise<void> {
  for (const document of LEGAL_DOCUMENT_SEED_METADATA) {
    if (
      !REQUIRED_PUBLISHED_LEGAL_SLUGS.includes(
        document.slug as (typeof REQUIRED_PUBLISHED_LEGAL_SLUGS)[number],
      )
    ) {
      continue;
    }
    const row = await prisma.legalDocument.upsert({
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
    if (row.currentPublishedVersionId) {
      continue;
    }
    const latest = await prisma.legalDocumentVersion.findFirst({
      where: { documentId: row.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const content = `A23a test ${document.slug}`;
    const version = await prisma.legalDocumentVersion.create({
      data: {
        documentId: row.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        title: document.title,
        content,
        contentHash: hashLegalDocumentContent(content),
        status: LegalDocumentVersionStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    await prisma.legalDocument.update({
      where: { id: row.id },
      data: {
        currentPublishedVersionId: version.id,
        isPublished: true,
        content,
      },
    });
  }
}

async function main(): Promise<void> {
  try {
    assertDisposableBotBookingTestDatabase(process.env.DATABASE_URL);
  } catch (error) {
    skipOrFail(
      `test-database-guard (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const table = await prisma.$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass('public.site_attributions')::text AS name
    `;
    if (!table[0]?.name) {
      skipOrFail("site_attributions migration is not applied");
    }
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    skipOrFail(
      `postgres unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const runId = randomUUID().slice(0, 8);
  const category = await prisma.serviceCategory.create({
    data: {
      name: `A23a Cat ${runId}`,
      sortOrder: 0,
      isActive: true,
      isPublic: true,
    },
  });
  const master = await prisma.master.create({
    data: {
      internalName: `a23a-mst-${runId}`,
      publicName: `A23a Master ${runId}`,
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
      internalName: `a23a-svc-${runId}`,
      publicName: `A23a Service ${runId}`,
      durationMinutes: 60,
      breakAfterMinutes: 0,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 0,
    },
  });
  await prisma.masterService.create({
    data: {
      masterId: master.id,
      serviceId: service.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 0,
    },
  });
  await publishRequiredLegalDocuments(prisma);

  let appointmentId: string | null = null;
  let bookingRequestId: string | null = null;
  let concurrentBookingRequestId: string | null = null;
  let constraintBookingRequestId: string | null = null;
  try {
    const submittedAttribution = {
      ...EMPTY_SITE_ATTRIBUTION,
      utm_source: "vk",
      utm_medium: "messenger",
      utm_campaign: "a23a",
      utm_content: "book",
      utm_term: "plasma",
      referrer: "https://vk.com/private/path?client=secret#fragment",
      source_marker: "campaign-link",
    };
    const attribution = {
      ...submittedAttribution,
      referrer: "https://vk.com",
    };
    const appointmentResult = await createOnlineAppointment(
      {
        masterId: master.id,
        serviceId: service.id,
        dateKey: "2030-01-01",
        startTime: "10:00",
        endTime: "11:00",
        clientName: "A23a Client",
        clientPhone: "+79001234567",
        recordPublicLegalAcceptances: true,
        siteAttribution: submittedAttribution,
      },
      createAppointmentServiceRuntime({
        recordPublicAcceptances: async () => undefined,
      }),
    );
    const appointment = appointmentResult.appointment;
    appointmentId = appointment.id;

    const requestIdempotencyKey = randomUUID();
    const requestInput = {
      clientName: "A23a Client",
      clientPhone: "+79001234567",
      type: "CONSULTATION_REQUEST" as const,
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: requestIdempotencyKey,
      attribution: submittedAttribution,
    };
    const request = await createBookingRequest(requestInput);
    bookingRequestId = request.id;
    const replay = await createBookingRequest(requestInput);
    assert.equal(replay.id, request.id);
    await assert.rejects(
      () =>
        createBookingRequest({
          ...requestInput,
          attribution: { ...submittedAttribution, utm_source: "yandex" },
        }),
      (error: unknown) =>
        error instanceof BookingRequestPublicError &&
        error.code === "IDEMPOTENCY_CONFLICT",
    );

    const concurrentKey = randomUUID();
    const sparseAttribution = {
      ...EMPTY_SITE_ATTRIBUTION,
      utm_source: "concurrent-first-touch",
    };
    const concurrentInput = {
      clientName: "A23a Concurrent",
      clientPhone: "+79001234568",
      type: "CONSULTATION_REQUEST" as const,
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: concurrentKey,
      attribution: sparseAttribution,
    };
    const concurrentResults = await Promise.all([
      createBookingRequest(concurrentInput),
      createBookingRequest(concurrentInput),
    ]);
    assert.equal(concurrentResults[0].id, concurrentResults[1].id);
    concurrentBookingRequestId = concurrentResults[0].id;
    assert.equal(
      await prisma.siteAttribution.count({
        where: { bookingRequestId: concurrentBookingRequestId },
      }),
      1,
    );

    assert.equal(
      await prisma.siteAttribution.count({
        where: { appointmentId: appointment.id },
      }),
      1,
    );
    assert.equal(
      await prisma.siteAttribution.count({
        where: { bookingRequestId: request.id },
      }),
      1,
    );

    const failedAppointmentName = `A23a rollback appointment ${runId}`;
    await assert.rejects(() =>
      createOnlineAppointment(
        {
          masterId: master.id,
          serviceId: service.id,
          dateKey: "2030-01-01",
          startTime: "12:00",
          endTime: "13:00",
          clientName: failedAppointmentName,
          clientPhone: "+79001234569",
          recordPublicLegalAcceptances: true,
          siteAttribution: {
            ...EMPTY_SITE_ATTRIBUTION,
            utm_source: "x".repeat(257),
          },
        },
        createAppointmentServiceRuntime({
          recordPublicAcceptances: async () => undefined,
        }),
      ),
    );
    assert.equal(
      await prisma.appointment.count({
        where: { clientName: failedAppointmentName },
      }),
      0,
    );

    const failedRequestKey = randomUUID();
    await assert.rejects(() =>
      createBookingRequest({
        clientName: "A23a rollback request",
        clientPhone: "+79001234570",
        type: "CONSULTATION_REQUEST",
        personalDataConsent: true,
        offerAcknowledgement: true,
        idempotencyKey: failedRequestKey,
        attribution: {
          ...EMPTY_SITE_ATTRIBUTION,
          utm_source: "x".repeat(257),
        },
      }),
    );
    assert.equal(
      await prisma.bookingRequest.count({
        where: { idempotencyKey: failedRequestKey },
      }),
      0,
    );

    const constraintAppointment = await prisma.appointment.create({
      data: {
        masterId: master.id,
        serviceId: service.id,
        startsAt: new Date("2030-01-01T09:00:00.000Z"),
        endsAt: new Date("2030-01-01T10:00:00.000Z"),
        clientName: "A23a constraint appointment",
        clientPhone: "+79001234571",
        status: "SCHEDULED",
        source: "ONLINE",
        creatorKind: "SELF_SERVICE",
      },
    });
    const constraintRequest = await prisma.bookingRequest.create({
      data: {
        clientName: "A23a constraint request",
        clientPhone: "+79001234572",
        status: "NEW",
        source: "ONLINE",
        type: "CONSULTATION_REQUEST",
      },
    });
    constraintBookingRequestId = constraintRequest.id;

    await assert.rejects(() =>
      prisma.$executeRaw`
        INSERT INTO "site_attributions" (
          "id", "appointment_id", "utm_source", "utm_medium",
          "utm_campaign", "utm_content", "utm_term", "referrer", "source_marker"
        ) VALUES (
          ${randomUUID()}::uuid, ${constraintAppointment.id}::uuid,
          NULL, '', '   ', E'\t',
          E'\n', '  ', NULL
        )
      `,
    );
    await assert.rejects(() =>
      prisma.$executeRaw`
        INSERT INTO "site_attributions" ("id", "utm_source")
        VALUES (${randomUUID()}::uuid, 'xor-none')
      `,
    );
    await assert.rejects(() =>
      prisma.$executeRaw`
        INSERT INTO "site_attributions" (
          "id", "appointment_id", "booking_request_id", "utm_source"
        ) VALUES (
          ${randomUUID()}::uuid, ${constraintAppointment.id}::uuid,
          ${constraintRequest.id}::uuid, 'xor-both'
        )
      `,
    );

    const cascadeAttributionId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "site_attributions" ("id", "appointment_id", "utm_source")
      VALUES (
        ${cascadeAttributionId}::uuid,
        ${constraintAppointment.id}::uuid,
        'unique-owner'
      )
    `;
    await assert.rejects(() =>
      prisma.$executeRaw`
        INSERT INTO "site_attributions" ("id", "appointment_id", "utm_source")
        VALUES (
          ${randomUUID()}::uuid,
          ${constraintAppointment.id}::uuid,
          'duplicate-owner'
        )
      `,
    );
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "site_attributions"
        SET "utm_source" = 'mutated'
        WHERE "id" = ${cascadeAttributionId}::uuid
      `,
    );
    await prisma.appointment.delete({ where: { id: constraintAppointment.id } });
    assert.equal(
      await prisma.siteAttribution.count({
        where: { id: cascadeAttributionId },
      }),
      0,
    );

    await assert.rejects(() =>
      prisma.siteAttribution.create({
        data: { appointmentId: appointment.id, utmSource: "later" },
      }),
    );
    await assert.rejects(() =>
      prisma.siteAttribution.update({
        where: { appointmentId: appointment.id },
        data: { utmSource: "later" },
      }),
    );

    const appointmentContext =
      await getBotBookingMethodAppointmentContext({
        appointmentId: appointment.id,
      });
    assert.equal(appointmentContext.ok, true);
    if (!appointmentContext.ok) throw new Error("appointment context failed");
    assert.deepEqual(appointmentContext.body.attribution, attribution);

    const requestContext = await getBotBookingRequest(request.id);
    assert.equal(requestContext.ok, true);
    if (!requestContext.ok) throw new Error("request context failed");
    assert.deepEqual(requestContext.body.item.attribution, attribution);

    const sparseRequestContext = await getBotBookingRequest(
      concurrentBookingRequestId,
    );
    assert.equal(sparseRequestContext.ok, true);
    if (!sparseRequestContext.ok) {
      throw new Error("sparse request context failed");
    }
    assert.deepEqual(
      sparseRequestContext.body.item.attribution,
      sparseAttribution,
    );

    const feed = await feedBotBookingRequests({
      limit: 50,
      cursor: {
        createdAt: new Date(
          Date.parse(concurrentResults[0].createdAt) - 1,
        ).toISOString(),
        id: "00000000-0000-4000-8000-000000000000",
      },
    });
    assert.equal(feed.ok, true);
    if (!feed.ok) throw new Error("booking request feed failed");
    const feedItem = feed.body.items.find(
      (item) => item.id === concurrentBookingRequestId,
    );
    assert.ok(feedItem);
    assert.equal(
      Object.prototype.hasOwnProperty.call(feedItem, "attribution"),
      false,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(feed.body), "utf8") < 65_536);

    console.log(
      "site-attribution PG checks: constraints, atomicity, replay, lean feed, contexts PASSED",
    );
  } finally {
    if (constraintBookingRequestId) {
      await prisma.bookingRequest.deleteMany({
        where: { id: constraintBookingRequestId },
      });
    }
    if (concurrentBookingRequestId) {
      await prisma.bookingRequest.deleteMany({
        where: { id: concurrentBookingRequestId },
      });
    }
    if (bookingRequestId) {
      await prisma.bookingRequest.deleteMany({ where: { id: bookingRequestId } });
    }
    if (appointmentId) {
      await prisma.appointment.deleteMany({ where: { id: appointmentId } });
    }
    await prisma.appointment.deleteMany({ where: { masterId: master.id } });
    await prisma.masterService.deleteMany({
      where: { masterId: master.id, serviceId: service.id },
    });
    await prisma.service.deleteMany({ where: { id: service.id } });
    await prisma.master.deleteMany({ where: { id: master.id } });
    await prisma.serviceCategory.deleteMany({ where: { id: category.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
