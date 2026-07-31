import {
  PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH,
  PROBLEM_REPORT_MAX_NAME_LENGTH,
  type ProblemReportStoredMeta,
} from "@/lib/problem-report/constants";
import {
  sanitizeProblemReportText,
  summarizeUserAgent,
} from "@/lib/problem-report/validation";

export type ProblemReportTelegramPayload = {
  requestId: string;
  clientName: string;
  clientPhone: string;
  description: string;
  createdAt: Date;
  meta: ProblemReportStoredMeta;
};

export function formatProblemReportTelegramMessage(
  payload: ProblemReportTelegramPayload,
): string {
  const name =
    sanitizeProblemReportText(payload.clientName, PROBLEM_REPORT_MAX_NAME_LENGTH) ||
    "—";
  const phone = sanitizeProblemReportText(payload.clientPhone, 32);
  const description = sanitizeProblemReportText(
    payload.description,
    PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH,
  );
  const page = sanitizeProblemReportText(payload.meta.pagePath, 300);
  const device = summarizeUserAgent(payload.meta.userAgent);
  const viewport =
    payload.meta.viewportWidth > 0 && payload.meta.viewportHeight > 0
      ? `${payload.meta.viewportWidth}×${payload.meta.viewportHeight}`
      : "—";
  const when = payload.createdAt.toISOString();

  return [
    "Проблема на сайте",
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    `Описание: ${description}`,
    `Страница: ${page}`,
    `Дата (UTC): ${when}`,
    `Устройство: ${device}`,
    `Viewport: ${viewport}`,
    `ID обращения: ${payload.requestId}`,
  ].join("\n");
}
