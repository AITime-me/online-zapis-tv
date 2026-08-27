/**
 * A2.3b1 one-time acquisition evidence — REQUIRED PostgreSQL proofs.
 * Fail-closed: unavailable / missing migration → exit 1. Never SKIPPED.
 *
 * Imports of @/lib/db and services are deferred until DATABASE_URL points at
 * the ephemeral instance (PrismaClient binds URL at construction time).
 */
process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  LegalDocumentVersionStatus,
  PrismaClient,
} from "@prisma/client";
import { hashLegalDocumentContent } from "../src/lib/legal-document/content-hash";
import {
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
} from "../src/lib/legal-document/defaults";
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

const LEGACY_BARE_CANONICAL =
  '{"clientName":"Test Client","clientPhone":"79000000000","comment":null,"gamePlayId":null,"gameSessionId":null,"masterId":null,"offerAcknowledgement":true,"personalDataConsent":true,"serviceId":null,"type":"CONSULTATION_REQUEST","attribution":{"utm_source":"vk","utm_medium":"cpc","utm_campaign":"summer_2026","utm_content":"button-1","utm_term":null,"referrer":"https://vk.com","source_marker":null}}';

const LEGACY_BARE_HASH =
  "0c3cd76684f6da6fef9064c0757554658459c58e1e1d025e726655eb0ee6933b";

function forceDevIdempotencySecret(): void {
  process.env.NODE_ENV = "development";
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
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
    const content = `A23b1 test ${document.slug}`;
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
  if (!REQUIRE_POSTGRES) {
    failRequired(
      "acquisition attribution DB suite requires --require-postgres (no SKIPPED)",
    );
  }

  forceDevIdempotencySecret();

  let ephemeral: EphemeralPostgres | null = null;
  try {
    ephemeral = await startEphemeralPostgres({
      namePrefix: "a23b1-acq-pg",
      databaseName: "a23b1_acquisition_test",
      password: "a23b1-acq-test",
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
  process.env.BOT_BOOKING_CREATE_ALLOW_TEST_DB_MUTATION = "true";

  try {
    runPrismaMigrateDeploy(databaseUrl);
  } catch (error) {
    await ephemeral.cleanup();
    failRequired(
      `fresh migrate deploy failed (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  // Bind Prisma + services only after DATABASE_URL points at ephemeral PG.
  const { prisma } = await import("../src/lib/db");
  const { EMPTY_SITE_ATTRIBUTION } = await import(
    "../src/lib/attribution/site-attribution"
  );
  const {
    buildBookingIdempotencyPayload,
    canonicalizeBookingIdempotencyPayloadForTests,
    computeIdempotencyPayloadHash,
  } = await import("../src/lib/booking-requests/idempotency-server");
  const {
    createAppointmentServiceRuntime,
    createOnlineAppointment,
  } = await import("../src/services/AppointmentService");
  const {
    BookingRequestPublicError,
    createBookingRequest,
  } = await import("../src/services/BookingRequestService");
  const {
    claimAcquisitionEvidenceForAppointment,
    issueAcquisitionEvidenceForLinkToken,
    mintAcquisitionLink,
  } = await import("../src/services/AcquisitionAttributionService");
  const { GET: acquisitionRedirectGet } = await import(
    "../src/app/a/[token]/route"
  );

  const runId = randomUUID().slice(0, 8);
  const appointmentIds: string[] = [];
  const bookingRequestIds: string[] = [];
  const linkHashes: string[] = [];
  const evidenceHashes: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    const tables = await prisma.$queryRaw<
      Array<{ links: string | null; evidence: string | null }>
    >`
      SELECT
        to_regclass('public.acquisition_links')::text AS links,
        to_regclass('public.acquisition_evidence')::text AS evidence
    `;
    if (!tables[0]?.links || !tables[0]?.evidence) {
      failRequired("acquisition link/evidence migrations are not applied");
    }

    const trigger = await prisma.$queryRaw<Array<{ tgenabled: string }>>`
      SELECT t.tgenabled::text AS tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'acquisition_evidence'
        AND t.tgname = 'acquisition_evidence_immutable_lifecycle_trg'
        AND NOT t.tgisinternal
    `;
    if (trigger.length !== 1) {
      failRequired("acquisition_evidence immutable lifecycle trigger missing");
    }

    // 2. Legacy fingerprint fixed vector (DEV HMAC).
    forceDevIdempotencySecret();
    const legacyPayload = buildBookingIdempotencyPayload({
      clientName: "Test Client",
      clientPhone: "+79000000000",
      type: "CONSULTATION_REQUEST",
      comment: null,
      masterId: null,
      serviceId: null,
      personalDataConsent: true,
      offerAcknowledgement: true,
      gamePlayId: null,
      gameSessionId: null,
      attribution: {
        ...EMPTY_SITE_ATTRIBUTION,
        utm_source: "vk",
        utm_medium: "cpc",
        utm_campaign: "summer_2026",
        utm_content: "button-1",
        referrer: "https://vk.com",
        source_marker: null,
      },
    });
    assert.equal(
      canonicalizeBookingIdempotencyPayloadForTests(legacyPayload),
      LEGACY_BARE_CANONICAL,
    );
    assert.equal(computeIdempotencyPayloadHash(legacyPayload), LEGACY_BARE_HASH);

    const category = await prisma.serviceCategory.create({
      data: {
        name: `A23b1 Cat ${runId}`,
        sortOrder: 0,
        isActive: true,
        isPublic: true,
      },
    });
    const master = await prisma.master.create({
      data: {
        internalName: `a23b1-mst-${runId}`,
        publicName: `A23b1 Master ${runId}`,
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
        internalName: `a23b1-svc-${runId}`,
        publicName: `A23b1 Service ${runId}`,
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

    const minted = await mintAcquisitionLink({
      sourceKey: "VK_ADS",
      utmCampaign: "a23b1",
      utmSource: "vk",
    });
    linkHashes.push(hashOpaqueToken(minted.token));
    const storedLink = await prisma.acquisitionLink.findUnique({
      where: { tokenHash: hashOpaqueToken(minted.token) },
    });
    assert.ok(storedLink);
    assert.equal(storedLink.sourceKey, "VK_ADS");
    assert.equal(JSON.stringify(storedLink).includes(minted.token), false);

    // 9. inactive link → no evidence
    const inactiveToken = generateOpaqueToken();
    linkHashes.push(hashOpaqueToken(inactiveToken));
    await prisma.acquisitionLink.create({
      data: {
        tokenHash: hashOpaqueToken(inactiveToken),
        sourceKey: "YANDEX",
        isActive: false,
        expiresAt: new Date("2035-01-01T00:00:00.000Z"),
      },
    });
    assert.equal(await issueAcquisitionEvidenceForLinkToken(inactiveToken), null);

    // 9. expired link → no evidence
    const expiredLinkToken = generateOpaqueToken();
    linkHashes.push(hashOpaqueToken(expiredLinkToken));
    await prisma.acquisitionLink.create({
      data: {
        tokenHash: hashOpaqueToken(expiredLinkToken),
        sourceKey: "TWO_GIS",
        isActive: true,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    assert.equal(
      await issueAcquisitionEvidenceForLinkToken(expiredLinkToken),
      null,
    );

    // 10. concurrent deactivate/issue — DB-consistent
    const raceLinkToken = generateOpaqueToken();
    linkHashes.push(hashOpaqueToken(raceLinkToken));
    await prisma.acquisitionLink.create({
      data: {
        tokenHash: hashOpaqueToken(raceLinkToken),
        sourceKey: "VK_CONTENT",
        isActive: true,
        expiresAt: new Date("2035-01-01T00:00:00.000Z"),
      },
    });
    const [issuedRace, deactivated] = await Promise.all([
      issueAcquisitionEvidenceForLinkToken(raceLinkToken),
      prisma.acquisitionLink.updateMany({
        where: { tokenHash: hashOpaqueToken(raceLinkToken) },
        data: { isActive: false },
      }),
    ]);
    assert.equal(deactivated.count, 1);
    if (issuedRace) {
      evidenceHashes.push(hashOpaqueToken(issuedRace.evidenceToken));
      assert.equal(issuedRace.sourceKey, "VK_CONTENT");
      const raceEvidence = await prisma.acquisitionEvidence.findUnique({
        where: { tokenHash: hashOpaqueToken(issuedRace.evidenceToken) },
      });
      assert.ok(raceEvidence);
      assert.equal(raceEvidence.sourceKey, "VK_CONTENT");
    } else {
      assert.equal(
        await prisma.acquisitionEvidence.count({
          where: {
            acquisitionLink: { tokenHash: hashOpaqueToken(raceLinkToken) },
          },
        }),
        0,
      );
    }

    const invalidRedirect = await acquisitionRedirectGet(
      new Request("http://localhost:3000/a/invalid"),
      { params: Promise.resolve({ token: "invalid" }) },
    );
    assert.equal(invalidRedirect.headers.get("set-cookie"), null);
    assert.equal(
      invalidRedirect.headers.get("location"),
      "http://localhost:3000/",
    );

    const firstRedirect = await acquisitionRedirectGet(
      new Request(`http://localhost:3000/a/${minted.token}`),
      { params: Promise.resolve({ token: minted.token }) },
    );
    assert.equal(firstRedirect.headers.get("set-cookie"), null);
    const location = firstRedirect.headers.get("location") ?? "";
    assert.match(location, /\/booking\?/);
    assert.match(location, /#acq=[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(location, /[?&]acq=/);
    const evidenceToken = new URL(location).hash.replace(/^#acq=/, "");
    assert.equal(evidenceToken.length, 43);
    evidenceHashes.push(hashOpaqueToken(evidenceToken));

    const evidenceRow = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(evidenceToken) },
    });
    assert.ok(evidenceRow);
    assert.equal(evidenceRow.sourceKey, "VK_ADS");
    assert.equal(evidenceRow.consumedAt, null);

    // 3+4. one-time consume + concurrent double consume → exactly one winner
    const raceAppointments = await Promise.all([
      createOnlineAppointment(
        {
          masterId: master.id,
          serviceId: service.id,
          dateKey: "2030-02-01",
          startTime: "10:00",
          endTime: "11:00",
          clientName: "A23b1 Race A",
          clientPhone: "+79001234001",
          recordPublicLegalAcceptances: true,
          siteAttribution: {
            ...EMPTY_SITE_ATTRIBUTION,
            utm_source: "vk",
            source_marker: "forged-client-marker",
          },
          acquisitionEvidenceToken: evidenceToken,
        },
        createAppointmentServiceRuntime({
          recordPublicAcceptances: async () => undefined,
        }),
      ),
      createOnlineAppointment(
        {
          masterId: master.id,
          serviceId: service.id,
          dateKey: "2030-02-01",
          startTime: "12:00",
          endTime: "13:00",
          clientName: "A23b1 Race B",
          clientPhone: "+79001234002",
          recordPublicLegalAcceptances: true,
          siteAttribution: {
            ...EMPTY_SITE_ATTRIBUTION,
            utm_source: "vk",
            source_marker: "forged-client-marker",
          },
          acquisitionEvidenceToken: evidenceToken,
        },
        createAppointmentServiceRuntime({
          recordPublicAcceptances: async () => undefined,
        }),
      ),
    ]);
    appointmentIds.push(
      raceAppointments[0].appointment.id,
      raceAppointments[1].appointment.id,
    );

    const markers = await Promise.all(
      raceAppointments.map(async (result) => {
        const row = await prisma.siteAttribution.findUnique({
          where: { appointmentId: result.appointment.id },
          select: { sourceMarker: true },
        });
        return row?.sourceMarker ?? null;
      }),
    );
    assert.equal(
      markers.filter((marker) => marker === "VK_ADS").length,
      1,
      "exactly one concurrent winner gets trusted marker",
    );
    assert.equal(
      markers.filter((marker) => marker === null).length,
      1,
      "loser must not get trusted marker",
    );

    const consumed = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(evidenceToken) },
    });
    assert.ok(consumed?.consumedAt);
    assert.equal(
      Boolean(consumed.appointmentId) !== Boolean(consumed.bookingRequestId),
      true,
    );

    // 5. re-arm rejected
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "acquisition_evidence"
        SET "consumed_at" = NULL, "appointment_id" = NULL
        WHERE "token_hash" = ${hashOpaqueToken(evidenceToken)}
      `,
    );

    // 7. source / expiry mutation rejected after issue/consume
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "acquisition_evidence"
        SET "source_key" = 'YANDEX'
        WHERE "token_hash" = ${hashOpaqueToken(evidenceToken)}
      `,
    );
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "acquisition_evidence"
        SET "expires_at" = ${new Date("2040-01-01T00:00:00.000Z")}
        WHERE "token_hash" = ${hashOpaqueToken(evidenceToken)}
      `,
    );

    // 6. owner swap / owner type swap rejected
    const swapIssued = await issueAcquisitionEvidenceForLinkToken(minted.token);
    assert.ok(swapIssued);
    evidenceHashes.push(hashOpaqueToken(swapIssued.evidenceToken));
    const swapRequest = await createBookingRequest({
      clientName: "A23b1 Swap Owner",
      clientPhone: "+79001234009",
      type: "CONSULTATION_REQUEST",
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: randomUUID(),
      attribution: EMPTY_SITE_ATTRIBUTION,
      acquisitionEvidenceToken: swapIssued.evidenceToken,
    });
    bookingRequestIds.push(swapRequest.id);
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "acquisition_evidence"
        SET "booking_request_id" = ${swapRequest.id}::uuid,
            "appointment_id" = NULL
        WHERE "token_hash" = ${hashOpaqueToken(evidenceToken)}
      `,
    );
    await assert.rejects(() =>
      prisma.$executeRaw`
        UPDATE "acquisition_evidence"
        SET "appointment_id" = ${raceAppointments[0].appointment.id}::uuid,
            "booking_request_id" = NULL
        WHERE "token_hash" = ${hashOpaqueToken(swapIssued.evidenceToken)}
      `,
    );

    // 11. transaction rollback restores unconsumed evidence
    const attrFailIssued = await issueAcquisitionEvidenceForLinkToken(
      minted.token,
    );
    assert.ok(attrFailIssued);
    evidenceHashes.push(hashOpaqueToken(attrFailIssued.evidenceToken));
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        const appointment = await tx.appointment.create({
          data: {
            masterId: master.id,
            serviceId: service.id,
            startsAt: new Date("2030-02-03T10:00:00.000Z"),
            endsAt: new Date("2030-02-03T11:00:00.000Z"),
            clientName: "A23b1 attr fail",
            clientPhone: "+79001234004",
            status: "SCHEDULED",
            source: "ONLINE",
            creatorKind: "SELF_SERVICE",
          },
        });
        appointmentIds.push(appointment.id);
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          attrFailIssued.evidenceToken,
          appointment.id,
        );
        assert.equal(claimed?.sourceKey, "VK_ADS");
        throw new Error("FORCE_ATTR_PERSISTENCE_FAIL");
      }),
    );
    const attrFailEvidence = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(attrFailIssued.evidenceToken) },
    });
    assert.equal(attrFailEvidence?.consumedAt, null);
    assert.equal(attrFailEvidence?.appointmentId, null);

    // 8. statement-time expiry boundary
    const staleToken = generateOpaqueToken();
    evidenceHashes.push(hashOpaqueToken(staleToken));
    await prisma.acquisitionEvidence.create({
      data: {
        tokenHash: hashOpaqueToken(staleToken),
        sourceKey: "YANDEX",
        acquisitionLinkId: storedLink.id,
        expiresAt: new Date(Date.now() + 2_000),
      },
    });
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        const appointment = await tx.appointment.create({
          data: {
            masterId: master.id,
            serviceId: service.id,
            startsAt: new Date("2030-02-05T10:00:00.000Z"),
            endsAt: new Date("2030-02-05T11:00:00.000Z"),
            clientName: "A23b1 stale expiry",
            clientPhone: "+79001234010",
            status: "SCHEDULED",
            source: "ONLINE",
            creatorKind: "SELF_SERVICE",
          },
        });
        appointmentIds.push(appointment.id);
        await tx.$executeRaw`SELECT pg_sleep(2.5)`;
        const claimed = await claimAcquisitionEvidenceForAppointment(
          tx,
          staleToken,
          appointment.id,
        );
        assert.equal(claimed, null);
        throw new Error("ABORT_STALE_EXPIRY_PROOF");
      }),
    );
    const staleStill = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(staleToken) },
    });
    assert.equal(staleStill?.consumedAt, null);
    assert.equal(staleStill?.appointmentId, null);

    // Already-expired evidence cannot mint trusted marker via conversion path.
    const expiredToken = generateOpaqueToken();
    evidenceHashes.push(hashOpaqueToken(expiredToken));
    await prisma.acquisitionEvidence.create({
      data: {
        tokenHash: hashOpaqueToken(expiredToken),
        sourceKey: "YANDEX",
        acquisitionLinkId: storedLink.id,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    const expiredAppointment = await createOnlineAppointment(
      {
        masterId: master.id,
        serviceId: service.id,
        dateKey: "2030-02-04",
        startTime: "10:00",
        endTime: "11:00",
        clientName: "A23b1 expired",
        clientPhone: "+79001234005",
        recordPublicLegalAcceptances: true,
        siteAttribution: EMPTY_SITE_ATTRIBUTION,
        acquisitionEvidenceToken: expiredToken,
      },
      createAppointmentServiceRuntime({
        recordPublicAcceptances: async () => undefined,
      }),
    );
    appointmentIds.push(expiredAppointment.appointment.id);
    const expiredAttr = await prisma.siteAttribution.findUnique({
      where: { appointmentId: expiredAppointment.appointment.id },
      select: { sourceMarker: true },
    });
    assert.equal(expiredAttr?.sourceMarker ?? null, null);

    // INSERT consumed-without-owner rejected by CHECK + trigger
    await assert.rejects(() =>
      prisma.$executeRaw`
        INSERT INTO "acquisition_evidence" (
          "id", "token_hash", "source_key", "acquisition_link_id",
          "expires_at", "consumed_at"
        ) VALUES (
          ${randomUUID()}::uuid,
          ${hashOpaqueToken(generateOpaqueToken())},
          'TWO_GIS',
          ${storedLink.id}::uuid,
          ${new Date("2035-01-01T00:00:00.000Z")},
          ${new Date("2030-01-01T00:00:00.000Z")}
        )
      `,
    );

    // BookingRequest: evidence claim + replay
    const requestEvidence = await issueAcquisitionEvidenceForLinkToken(
      minted.token,
    );
    assert.ok(requestEvidence);
    evidenceHashes.push(hashOpaqueToken(requestEvidence.evidenceToken));

    const requestKey = randomUUID();
    const requestInput = {
      clientName: "A23b1 Request",
      clientPhone: "+79001234006",
      type: "CONSULTATION_REQUEST" as const,
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: requestKey,
      attribution: {
        ...EMPTY_SITE_ATTRIBUTION,
        utm_source: "vk",
        source_marker: "forged",
      },
      acquisitionEvidenceToken: requestEvidence.evidenceToken,
    };
    const createdRequest = await createBookingRequest(requestInput);
    bookingRequestIds.push(createdRequest.id);
    const replaySame = await createBookingRequest(requestInput);
    assert.equal(replaySame.id, createdRequest.id);
    const boundEvidence = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(requestEvidence.evidenceToken) },
    });
    assert.equal(boundEvidence?.bookingRequestId, createdRequest.id);
    assert.ok(boundEvidence?.consumedAt);

    const requestAttr = await prisma.siteAttribution.findUnique({
      where: { bookingRequestId: createdRequest.id },
      select: { sourceMarker: true },
    });
    assert.equal(requestAttr?.sourceMarker, "VK_ADS");

    // 12. BookingRequest bare legacy replay
    const bareKey = randomUUID();
    const bareAttribution = {
      ...EMPTY_SITE_ATTRIBUTION,
      utm_source: "vk",
      utm_medium: "cpc",
      utm_campaign: "summer_2026",
      utm_content: "button-1",
      referrer: "https://vk.com",
      source_marker: null,
    };
    const bareRequest = await createBookingRequest({
      clientName: "Test Client",
      clientPhone: "+79000000000",
      type: "CONSULTATION_REQUEST",
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: bareKey,
      attribution: bareAttribution,
    });
    bookingRequestIds.push(bareRequest.id);
    // Upgrade-compat: stored hash equals exact legacy vector.
    await prisma.bookingRequest.update({
      where: { id: bareRequest.id },
      data: { idempotencyPayloadHash: LEGACY_BARE_HASH },
    });
    const bareReplay = await createBookingRequest({
      clientName: "Test Client",
      clientPhone: "+79000000000",
      type: "CONSULTATION_REQUEST",
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: bareKey,
      attribution: bareAttribution,
    });
    assert.equal(bareReplay.id, bareRequest.id);
    assert.equal(
      (
        await prisma.bookingRequest.findUnique({
          where: { id: bareRequest.id },
          select: { idempotencyPayloadHash: true },
        })
      )?.idempotencyPayloadHash,
      LEGACY_BARE_HASH,
    );

    // 13. bare → evidence conflict leaves evidence free
    const lateEvidence = await issueAcquisitionEvidenceForLinkToken(
      minted.token,
    );
    assert.ok(lateEvidence);
    evidenceHashes.push(hashOpaqueToken(lateEvidence.evidenceToken));
    await assert.rejects(
      () =>
        createBookingRequest({
          clientName: "Test Client",
          clientPhone: "+79000000000",
          type: "CONSULTATION_REQUEST",
          personalDataConsent: true,
          offerAcknowledgement: true,
          idempotencyKey: bareKey,
          attribution: bareAttribution,
          acquisitionEvidenceToken: lateEvidence.evidenceToken,
        }),
      (error: unknown) =>
        error instanceof BookingRequestPublicError &&
        error.code === "IDEMPOTENCY_CONFLICT",
    );
    const lateStillFree = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(lateEvidence.evidenceToken) },
    });
    assert.equal(lateStillFree?.consumedAt, null);

    // 14. evidence A → B conflict leaves B free
    const swapKey = randomUUID();
    const evidenceA = await issueAcquisitionEvidenceForLinkToken(minted.token);
    const evidenceB = await issueAcquisitionEvidenceForLinkToken(minted.token);
    assert.ok(evidenceA && evidenceB);
    evidenceHashes.push(
      hashOpaqueToken(evidenceA.evidenceToken),
      hashOpaqueToken(evidenceB.evidenceToken),
    );
    const withA = await createBookingRequest({
      clientName: "A23b1 Swap",
      clientPhone: "+79001234008",
      type: "CONSULTATION_REQUEST",
      personalDataConsent: true,
      offerAcknowledgement: true,
      idempotencyKey: swapKey,
      attribution: EMPTY_SITE_ATTRIBUTION,
      acquisitionEvidenceToken: evidenceA.evidenceToken,
    });
    bookingRequestIds.push(withA.id);
    await assert.rejects(
      () =>
        createBookingRequest({
          clientName: "A23b1 Swap",
          clientPhone: "+79001234008",
          type: "CONSULTATION_REQUEST",
          personalDataConsent: true,
          offerAcknowledgement: true,
          idempotencyKey: swapKey,
          attribution: EMPTY_SITE_ATTRIBUTION,
          acquisitionEvidenceToken: evidenceB.evidenceToken,
        }),
      (error: unknown) =>
        error instanceof BookingRequestPublicError &&
        error.code === "IDEMPOTENCY_CONFLICT",
    );
    const bFree = await prisma.acquisitionEvidence.findUnique({
      where: { tokenHash: hashOpaqueToken(evidenceB.evidenceToken) },
    });
    assert.equal(bFree?.consumedAt, null);

    // Cascade/delete: deleting appointment removes owned evidence row.
    const cascadeIssued = await issueAcquisitionEvidenceForLinkToken(
      minted.token,
    );
    assert.ok(cascadeIssued);
    evidenceHashes.push(hashOpaqueToken(cascadeIssued.evidenceToken));
    const cascadeAppt = await createOnlineAppointment(
      {
        masterId: master.id,
        serviceId: service.id,
        dateKey: "2030-02-06",
        startTime: "10:00",
        endTime: "11:00",
        clientName: "A23b1 cascade",
        clientPhone: "+79001234011",
        recordPublicLegalAcceptances: true,
        siteAttribution: { ...EMPTY_SITE_ATTRIBUTION, utm_source: "vk" },
        acquisitionEvidenceToken: cascadeIssued.evidenceToken,
      },
      createAppointmentServiceRuntime({
        recordPublicAcceptances: async () => undefined,
      }),
    );
    await prisma.appointment.delete({ where: { id: cascadeAppt.appointment.id } });
    assert.equal(
      await prisma.acquisitionEvidence.count({
        where: { tokenHash: hashOpaqueToken(cascadeIssued.evidenceToken) },
      }),
      0,
    );

    console.log(
      "acquisition attribution PG checks: REQUIRED PG = PASS (lifecycle, statement-time, legacy fingerprint, concurrency)",
    );
  } finally {
    if (bookingRequestIds.length > 0) {
      await prisma.bookingRequest
        .deleteMany({ where: { id: { in: bookingRequestIds } } })
        .catch(() => undefined);
    }
    if (appointmentIds.length > 0) {
      await prisma.appointment
        .deleteMany({ where: { id: { in: appointmentIds } } })
        .catch(() => undefined);
    }
    if (evidenceHashes.length > 0) {
      await prisma.acquisitionEvidence
        .deleteMany({ where: { tokenHash: { in: evidenceHashes } } })
        .catch(() => undefined);
    }
    if (linkHashes.length > 0) {
      await prisma.acquisitionLink
        .deleteMany({ where: { tokenHash: { in: linkHashes } } })
        .catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
    await ephemeral.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
