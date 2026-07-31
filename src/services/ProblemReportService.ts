import "server-only";

import { LegalDocumentVersionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone/normalize-phone";
import {
  buildProblemReportMeta,
  encodeProblemReportComment,
  getFirstProblemReportError,
  hasProblemReportFieldErrors,
  validateProblemReportInput,
  type ProblemReportInput,
} from "@/lib/problem-report/validation";
import { sendProblemReportTelegramNotification } from "@/lib/problem-report/telegram";
import { recordPersonalDataConsentAcceptance } from "@/services/LegalAcceptanceService";
import { LegalDocumentsNotReadyError } from "@/services/LegalDocumentService";
import { BookingRequestValidationError } from "@/services/BookingRequestService";

export type CreateWebsiteProblemReportResult = {
  id: string;
  createdAt: string;
};

/**
 * Создаёт внутреннее обращение WEBSITE_PROBLEM_REPORT.
 * Не создаёт Client / Appointment. Telegram — best-effort после commit.
 */
export async function createWebsiteProblemReport(
  input: ProblemReportInput,
): Promise<CreateWebsiteProblemReportResult> {
  const clientName = input.clientName.trim();
  const clientPhone = input.clientPhone.trim();
  const description = input.description.trim();

  const fieldErrors = validateProblemReportInput({
    ...input,
    clientName,
    clientPhone,
    description,
  });
  if (hasProblemReportFieldErrors(fieldErrors)) {
    throw new BookingRequestValidationError(
      getFirstProblemReportError(fieldErrors),
    );
  }

  await assertConsentDocumentPublished();

  const meta = buildProblemReportMeta(input);
  const comment = encodeProblemReportComment(description, meta);
  const phoneNormalized = normalizePhone(clientPhone);

  let createdId: string;
  let createdAt: Date;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.bookingRequest.create({
        data: {
          clientName: clientName || "Без имени",
          clientPhone,
          clientPhoneNormalized: phoneNormalized,
          comment,
          masterId: null,
          serviceId: null,
          serviceNameSnapshot: null,
          type: "WEBSITE_PROBLEM_REPORT",
          source: "WEBSITE_PROBLEM_REPORT",
          status: "NEW",
          clientId: null,
          appointmentId: null,
        },
      });

      await recordPersonalDataConsentAcceptance(tx, {
        source: "WEBSITE_PROBLEM_REPORT",
        bookingRequestId: row.id,
        clientId: null,
      });

      return row;
    });

    createdId = created.id;
    createdAt = created.createdAt;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "REQUIRED_LEGAL_VERSIONS_MISSING"
    ) {
      throw new LegalDocumentsNotReadyError(["consent"]);
    }
    throw error;
  }

  // Fail-safe: Telegram errors must not undo the saved request.
  await sendProblemReportTelegramNotification({
    requestId: createdId,
    clientName: clientName || "Без имени",
    clientPhone,
    description,
    createdAt,
    meta,
  });

  return {
    id: createdId,
    createdAt: createdAt.toISOString(),
  };
}

async function assertConsentDocumentPublished(): Promise<void> {
  const row = await prisma.legalDocument.findUnique({
    where: { slug: "consent" },
    include: { currentPublishedVersion: true },
  });
  const version = row?.currentPublishedVersion;
  if (
    !row ||
    !version ||
    version.status !== LegalDocumentVersionStatus.PUBLISHED ||
    !version.content.trim()
  ) {
    throw new LegalDocumentsNotReadyError(["consent"]);
  }
}
