import "server-only";

import {
  LegalDocumentVersionStatus,
  type LegalAcceptanceSource,
  type LegalAcceptanceType,
  type Prisma,
} from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type PublicLegalAcceptanceLink = {
  source: LegalAcceptanceSource;
  appointmentId?: string | null;
  bookingRequestId?: string | null;
  clientId?: string | null;
  gamePlayId?: string | null;
  requestReference?: string | null;
};

async function requirePublishedVersion(tx: Tx, slug: string) {
  const row = await tx.legalDocument.findUnique({
    where: { slug },
    include: { currentPublishedVersion: true },
  });

  const version = row?.currentPublishedVersion;
  if (
    !row ||
    !version ||
    version.status !== LegalDocumentVersionStatus.PUBLISHED ||
    !version.content.trim()
  ) {
    throw new Error("REQUIRED_LEGAL_VERSIONS_MISSING");
  }

  return { document: row, version };
}

/**
 * Записывает обязательные подтверждения публичной формы в той же транзакции,
 * что и создание заявки/записи. Не пишет MARKETING_CONSENT.
 */
export async function recordRequiredPublicFormAcceptances(
  tx: Tx,
  link: PublicLegalAcceptanceLink,
): Promise<void> {
  const consentPublished = await requirePublishedVersion(tx, "consent");
  const termsPublished = await requirePublishedVersion(tx, "terms");

  const rows: Array<{
    acceptanceType: LegalAcceptanceType;
    documentVersionId: string;
    documentSlug: string;
    contentHash: string;
  }> = [
    {
      acceptanceType: "PERSONAL_DATA_CONSENT",
      documentVersionId: consentPublished.version.id,
      documentSlug: consentPublished.document.slug,
      contentHash: consentPublished.version.contentHash,
    },
    {
      acceptanceType: "OFFER_ACKNOWLEDGEMENT",
      documentVersionId: termsPublished.version.id,
      documentSlug: termsPublished.document.slug,
      contentHash: termsPublished.version.contentHash,
    },
  ];

  await tx.legalAcceptanceRecord.createMany({
    data: rows.map((row) => ({
      acceptanceType: row.acceptanceType,
      documentVersionId: row.documentVersionId,
      documentSlug: row.documentSlug,
      contentHash: row.contentHash,
      source: link.source,
      appointmentId: link.appointmentId ?? null,
      bookingRequestId: link.bookingRequestId ?? null,
      clientId: link.clientId ?? null,
      gamePlayId: link.gamePlayId ?? null,
      requestReference: link.requestReference ?? null,
    })),
  });
}

export function resolveAcceptanceSourceForBookingRequestType(
  type: "MANAGER_REQUEST" | "CONSULTATION_REQUEST",
  hasGamePlay: boolean,
): LegalAcceptanceSource {
  if (hasGamePlay) {
    return "GAME_CLAIM";
  }
  if (type === "MANAGER_REQUEST") {
    return "MANAGER_REQUEST";
  }
  return "CONSULTATION_REQUEST";
}
