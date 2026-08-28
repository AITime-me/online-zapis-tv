import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ACQUISITION_EVIDENCE_TTL_MS,
  ACQUISITION_LINK_TTL_MS,
  AcquisitionAttributionValidationError,
  buildAcquisitionBookingRedirectPath,
  parseAcquisitionLinkUtmInput,
  requireAcquisitionSourceKey,
  type AcquisitionSourceKey,
  type AcquisitionUtmFields,
} from "@/lib/attribution/trusted-acquisition";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isPlausibleOpaqueToken,
} from "@/lib/security/opaque-token";

type AcquisitionLinkDb = Pick<Prisma.TransactionClient, "acquisitionLink">;
type AcquisitionEvidenceClaimDb = Pick<Prisma.TransactionClient, "$queryRaw">;
type AcquisitionIssueDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export type MintedAcquisitionLink = {
  token: string;
  publicPath: string;
  sourceKey: AcquisitionSourceKey;
  utm: AcquisitionUtmFields;
  expiresAt: Date;
};

export type IssuedAcquisitionEvidence = {
  evidenceToken: string;
  redirectPath: string;
  sourceKey: AcquisitionSourceKey;
  expiresAt: Date;
};

export async function mintAcquisitionLink(
  input: {
    sourceKey: unknown;
    utmSource?: unknown;
    utmMedium?: unknown;
    utmCampaign?: unknown;
    utmContent?: unknown;
    utmTerm?: unknown;
  },
  db: AcquisitionLinkDb = prisma,
  now: Date = new Date(),
): Promise<MintedAcquisitionLink> {
  const sourceKey = requireAcquisitionSourceKey(input.sourceKey);
  const utm = parseAcquisitionLinkUtmInput({
    utm_source: input.utmSource,
    utm_medium: input.utmMedium,
    utm_campaign: input.utmCampaign,
    utm_content: input.utmContent,
    utm_term: input.utmTerm,
  });
  const token = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + ACQUISITION_LINK_TTL_MS);

  await db.acquisitionLink.create({
    data: {
      tokenHash: hashOpaqueToken(token),
      sourceKey,
      utmSource: utm.utm_source,
      utmMedium: utm.utm_medium,
      utmCampaign: utm.utm_campaign,
      utmContent: utm.utm_content,
      utmTerm: utm.utm_term,
      expiresAt,
    },
  });

  return {
    token,
    publicPath: `/a/${token}`,
    sourceKey,
    utm,
    expiresAt,
  };
}

/**
 * Issues a NEW one-time evidence bearer only if the AcquisitionLink still
 * qualifies at DB statement time (hash + active + expires_at > statement_timestamp()).
 * No stale application pre-read may authorize issuance.
 */
export async function issueAcquisitionEvidenceForLinkToken(
  linkToken: string | null | undefined,
  db: AcquisitionIssueDb = prisma,
): Promise<IssuedAcquisitionEvidence | null> {
  if (!linkToken || !isPlausibleOpaqueToken(linkToken)) {
    return null;
  }

  const evidenceToken = generateOpaqueToken();
  const linkHash = hashOpaqueToken(linkToken);
  const evidenceHash = hashOpaqueToken(evidenceToken);

  const rows = await db.$queryRaw<
    Array<{
      source_key: string;
      expires_at: Date;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      utm_content: string | null;
      utm_term: string | null;
    }>
  >(Prisma.sql`
    WITH qualifying_link AS (
      SELECT
        al."id",
        al."source_key",
        al."utm_source",
        al."utm_medium",
        al."utm_campaign",
        al."utm_content",
        al."utm_term"
      FROM "acquisition_links" AS al
      WHERE al."token_hash" = ${linkHash}
        AND al."is_active" = true
        AND al."expires_at" > statement_timestamp()
      FOR UPDATE
    ),
    inserted AS (
      INSERT INTO "acquisition_evidence" (
        "id",
        "token_hash",
        "source_key",
        "acquisition_link_id",
        "expires_at"
      )
      SELECT
        gen_random_uuid(),
        ${evidenceHash},
        ql."source_key",
        ql."id",
        statement_timestamp() + (${ACQUISITION_EVIDENCE_TTL_MS}::bigint * interval '1 millisecond')
      FROM qualifying_link AS ql
      RETURNING
        "source_key",
        "expires_at",
        "acquisition_link_id"
    )
    SELECT
      i."source_key",
      i."expires_at",
      ql."utm_source",
      ql."utm_medium",
      ql."utm_campaign",
      ql."utm_content",
      ql."utm_term"
    FROM inserted AS i
    INNER JOIN qualifying_link AS ql ON ql."id" = i."acquisition_link_id"
  `);

  const row = rows[0];
  if (!row) {
    return null;
  }

  let sourceKey: AcquisitionSourceKey;
  try {
    sourceKey = requireAcquisitionSourceKey(row.source_key);
  } catch {
    throw new AcquisitionAttributionValidationError(
      "Некорректный source_key у acquisition link",
    );
  }

  const utm: AcquisitionUtmFields = {
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_content: row.utm_content,
    utm_term: row.utm_term,
  };

  return {
    evidenceToken,
    redirectPath: buildAcquisitionBookingRedirectPath({
      utm,
      evidenceToken,
    }),
    sourceKey,
    expiresAt: row.expires_at,
  };
}

/**
 * Atomically claim one-time evidence using DB statement_timestamp() for
 * consumed_at (business time) and singleton integer clock for feed_order
 * (commit-ordered feed pagination) in the SAME SQL statement.
 */
async function claimAcquisitionEvidence(input: {
  db: AcquisitionEvidenceClaimDb;
  rawToken: string | null | undefined;
  appointmentId?: string;
  bookingRequestId?: string;
}): Promise<{ sourceKey: AcquisitionSourceKey } | null> {
  if (!input.rawToken || !isPlausibleOpaqueToken(input.rawToken)) {
    return null;
  }
  if (
    (input.appointmentId && input.bookingRequestId) ||
    (!input.appointmentId && !input.bookingRequestId)
  ) {
    throw new Error("ACQUISITION_EVIDENCE_OWNER_XOR");
  }

  const tokenHash = hashOpaqueToken(input.rawToken);
  const appointmentId = input.appointmentId ?? null;
  const bookingRequestId = input.bookingRequestId ?? null;

  const rows = await input.db.$queryRaw<Array<{ source_key: string }>>(
    Prisma.sql`
      WITH "locked_clock" AS (
        SELECT "last_order"
        FROM "acquisition_evidence_feed_order_clock"
        WHERE "id" = 'singleton'
        FOR UPDATE
      ),
      "next_order" AS (
        SELECT "lc"."last_order" + 1 AS "feed_order"
        FROM "locked_clock" AS "lc"
      ),
      "claimed" AS (
        UPDATE "acquisition_evidence" AS "ae"
        SET
          "consumed_at" = statement_timestamp(),
          "feed_order" = (SELECT "feed_order" FROM "next_order"),
          "appointment_id" = ${appointmentId}::uuid,
          "booking_request_id" = ${bookingRequestId}::uuid
        WHERE "ae"."token_hash" = ${tokenHash}
          AND "ae"."consumed_at" IS NULL
          AND "ae"."expires_at" > statement_timestamp()
        RETURNING "ae"."source_key", "ae"."feed_order"
      ),
      "updated_clock" AS (
        UPDATE "acquisition_evidence_feed_order_clock" AS "c"
        SET "last_order" = "cl"."feed_order"
        FROM "claimed" AS "cl"
        WHERE "c"."id" = 'singleton'
        RETURNING "c"."last_order"
      )
      SELECT "source_key" FROM "claimed"
    `,
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  try {
    return { sourceKey: requireAcquisitionSourceKey(row.source_key) };
  } catch {
    throw new AcquisitionAttributionValidationError(
      "Некорректный source_key у acquisition evidence",
    );
  }
}

/**
 * Atomically claim one-time evidence for an Appointment inside the conversion TX.
 * Invalid / expired / already-consumed evidence returns null (no trusted marker).
 */
export async function claimAcquisitionEvidenceForAppointment(
  db: AcquisitionEvidenceClaimDb,
  rawToken: string | null | undefined,
  appointmentId: string,
): Promise<{ sourceKey: AcquisitionSourceKey } | null> {
  return claimAcquisitionEvidence({
    db,
    rawToken,
    appointmentId,
  });
}

/**
 * Atomically claim one-time evidence for a BookingRequest inside the conversion TX.
 * Invalid / expired / already-consumed evidence returns null (no trusted marker).
 */
export async function claimAcquisitionEvidenceForBookingRequest(
  db: AcquisitionEvidenceClaimDb,
  rawToken: string | null | undefined,
  bookingRequestId: string,
): Promise<{ sourceKey: AcquisitionSourceKey } | null> {
  return claimAcquisitionEvidence({
    db,
    rawToken,
    bookingRequestId,
  });
}
