import { NextResponse } from "next/server";
import { CommunicationsCampaignValidationError } from "@/services/CommunicationsCampaignService";
import { CommunicationsImportValidationError } from "@/services/CommunicationsImportService";
import { CommunicationsSegmentValidationError } from "@/services/CommunicationsSegmentService";
import { CommunicationsRedirectValidationError } from "@/services/CommunicationsRedirectService";

export function communicationsAdminErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof CommunicationsImportValidationError ||
    error instanceof CommunicationsCampaignValidationError ||
    error instanceof CommunicationsSegmentValidationError ||
    error instanceof CommunicationsRedirectValidationError
  ) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes("VK-коннектор") ||
      message.includes("Запрещённая схема") ||
      message.includes("Некорректная ссылка")
    ) {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
  }

  return NextResponse.json(
    { ok: false, error: "Ошибка модуля коммуникаций" },
    { status: 500 },
  );
}
