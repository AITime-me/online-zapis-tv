import { NextResponse } from "next/server";
import {
  getFirstProblemReportError,
  hasProblemReportFieldErrors,
  sanitizeProblemReportPagePath,
  sanitizeProblemReportUserAgent,
  sanitizeViewportSize,
  validateProblemReportInput,
} from "@/lib/problem-report/validation";
import { enforceSameOriginForMutatingRequest } from "@/lib/security/csrf";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { enforceValidatedPhoneRateLimit } from "@/lib/security/rate-limit/booking-phone";
import { BookingRequestValidationError } from "@/services/BookingRequestService";
import { createWebsiteProblemReport } from "@/services/ProblemReportService";
import { LegalDocumentsNotReadyError } from "@/services/LegalDocumentService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProblemReportBody = {
  clientName?: unknown;
  clientPhone?: unknown;
  description?: unknown;
  personalDataConsent?: unknown;
  pagePath?: unknown;
  userAgent?: unknown;
  viewportWidth?: unknown;
  viewportHeight?: unknown;
  // Rejected if present from client:
  status?: unknown;
  type?: unknown;
  source?: unknown;
  role?: unknown;
  recipient?: unknown;
  clientId?: unknown;
  appointmentId?: unknown;
};

export async function POST(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const originResponse = enforceSameOriginForMutatingRequest(request);
  if (originResponse) {
    return originResponse;
  }

  try {
    const body = (await request.json()) as ProblemReportBody;

    // Do not accept privileged/internal fields from the client.
    if (
      body.status !== undefined ||
      body.type !== undefined ||
      body.source !== undefined ||
      body.role !== undefined ||
      body.recipient !== undefined ||
      body.clientId !== undefined ||
      body.appointmentId !== undefined
    ) {
      return NextResponse.json(
        { ok: false, error: "Некорректные поля запроса" },
        { status: 400 },
      );
    }

    const clientName =
      typeof body.clientName === "string" ? body.clientName : "";
    const clientPhone =
      typeof body.clientPhone === "string" ? body.clientPhone.trim() : "";
    const description =
      typeof body.description === "string" ? body.description : "";
    const headerUa = request.headers.get("user-agent") ?? "";
    const clientUa =
      typeof body.userAgent === "string" ? body.userAgent : headerUa;

    const input = {
      clientName,
      clientPhone,
      description,
      personalDataConsent: body.personalDataConsent === true,
      pagePath: sanitizeProblemReportPagePath(body.pagePath),
      userAgent: sanitizeProblemReportUserAgent(clientUa || headerUa),
      viewportWidth: sanitizeViewportSize(body.viewportWidth),
      viewportHeight: sanitizeViewportSize(body.viewportHeight),
    };

    const fieldErrors = validateProblemReportInput(input);
    if (hasProblemReportFieldErrors(fieldErrors)) {
      return NextResponse.json(
        {
          ok: false,
          error: getFirstProblemReportError(fieldErrors),
          fieldErrors,
        },
        { status: 400 },
      );
    }

    const phoneRateLimitResponse = enforceValidatedPhoneRateLimit(
      request,
      "problemReport",
      clientPhone,
    );
    if (phoneRateLimitResponse) {
      return phoneRateLimitResponse;
    }

    const created = await createWebsiteProblemReport(input);

    return NextResponse.json({
      ok: true,
      id: created.id,
      message: "Спасибо! Сообщение отправлено. Мы свяжемся с вами.",
    });
  } catch (error) {
    if (error instanceof LegalDocumentsNotReadyError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: "LEGAL_DOCUMENTS_NOT_READY",
          missingSlugs: error.missingSlugs,
        },
        { status: 503 },
      );
    }

    if (error instanceof BookingRequestValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    throw error;
  }
}
