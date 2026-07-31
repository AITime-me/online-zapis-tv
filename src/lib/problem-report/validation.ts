import {
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
  countPhoneDigits,
  isClientConsentGiven,
} from "@/lib/booking/client-validation";
import {
  PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH,
  PROBLEM_REPORT_MAX_NAME_LENGTH,
  PROBLEM_REPORT_MAX_PAGE_PATH_LENGTH,
  PROBLEM_REPORT_MAX_USER_AGENT_LENGTH,
  PROBLEM_REPORT_MIN_DESCRIPTION_LENGTH,
  PROBLEM_REPORT_META_MARKER,
  PROBLEM_REPORT_SOURCE,
  type ParsedProblemReportComment,
  type ProblemReportClientMeta,
  type ProblemReportStoredMeta,
} from "@/lib/problem-report/constants";

export type ProblemReportFieldErrors = {
  name?: string;
  phone?: string;
  description?: string;
  personalDataConsent?: string;
  pagePath?: string;
};

export type ProblemReportInput = {
  clientName: string;
  clientPhone: string;
  description: string;
  personalDataConsent: boolean;
  pagePath: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
};

export function sanitizeProblemReportPagePath(raw: unknown): string {
  if (typeof raw !== "string") {
    return "/booking";
  }

  const trimmed = raw.trim().slice(0, PROBLEM_REPORT_MAX_PAGE_PATH_LENGTH);
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/booking";
  }

  try {
    const url = new URL(trimmed, "https://example.invalid");
    // Persist pathname only — never query string, fragment, or secrets.
    const path = url.pathname || "/booking";
    return path.slice(0, PROBLEM_REPORT_MAX_PAGE_PATH_LENGTH) || "/booking";
  } catch {
    const pathOnly = trimmed.split(/[?#]/)[0] ?? "/booking";
    return pathOnly.slice(0, PROBLEM_REPORT_MAX_PAGE_PATH_LENGTH) || "/booking";
  }
}

export function sanitizeProblemReportUserAgent(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, PROBLEM_REPORT_MAX_USER_AGENT_LENGTH);
}

export function sanitizeViewportSize(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(10_000, Math.round(raw)));
}

export function summarizeUserAgent(userAgent: string): string {
  const ua = sanitizeProblemReportUserAgent(userAgent);
  if (!ua) {
    return "неизвестно";
  }

  let browser = "Браузер";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";

  let os = "ОС";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return `${browser} / ${os}`;
}

export function validateProblemReportInput(
  input: ProblemReportInput,
): ProblemReportFieldErrors {
  const errors: ProblemReportFieldErrors = {};
  const name = input.clientName.trim();
  const phone = input.clientPhone.trim();
  const description = input.description.trim();
  const digitCount = countPhoneDigits(phone);

  if (name.length > PROBLEM_REPORT_MAX_NAME_LENGTH) {
    errors.name = `Имя не длиннее ${PROBLEM_REPORT_MAX_NAME_LENGTH} символов`;
  }

  if (!phone || digitCount === 0) {
    errors.phone = "Введите номер телефона";
  } else if (
    digitCount < MIN_PHONE_DIGITS ||
    digitCount > MAX_PHONE_DIGITS ||
    !/^\+\d+$/.test(phone)
  ) {
    errors.phone = "Номер введён некорректно";
  }

  if (description.length < PROBLEM_REPORT_MIN_DESCRIPTION_LENGTH) {
    errors.description = "Опишите проблему";
  } else if (description.length > PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH) {
    errors.description = `Описание не длиннее ${PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH} символов`;
  }

  if (!isClientConsentGiven(input.personalDataConsent)) {
    errors.personalDataConsent =
      "Необходимо согласие на обработку персональных данных";
  }

  const pagePath = sanitizeProblemReportPagePath(input.pagePath);
  if (!pagePath.startsWith("/")) {
    errors.pagePath = "Некорректная страница";
  }

  return errors;
}

export function hasProblemReportFieldErrors(
  errors: ProblemReportFieldErrors,
): boolean {
  return Boolean(
    errors.name ||
      errors.phone ||
      errors.description ||
      errors.personalDataConsent ||
      errors.pagePath,
  );
}

export function getFirstProblemReportError(
  errors: ProblemReportFieldErrors,
): string {
  return (
    errors.name ??
    errors.phone ??
    errors.description ??
    errors.personalDataConsent ??
    errors.pagePath ??
    "Заполните обязательные поля"
  );
}

export function buildProblemReportMeta(
  input: Pick<
    ProblemReportInput,
    "pagePath" | "userAgent" | "viewportWidth" | "viewportHeight"
  >,
): ProblemReportStoredMeta {
  return {
    source: PROBLEM_REPORT_SOURCE,
    pagePath: sanitizeProblemReportPagePath(input.pagePath),
    userAgent: sanitizeProblemReportUserAgent(input.userAgent),
    viewportWidth: sanitizeViewportSize(input.viewportWidth),
    viewportHeight: sanitizeViewportSize(input.viewportHeight),
  };
}

export function encodeProblemReportComment(
  description: string,
  meta: ProblemReportStoredMeta,
): string {
  const safeDescription = description
    .trim()
    .slice(0, PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH);
  const payload = JSON.stringify({
    source: meta.source,
    pagePath: meta.pagePath,
    userAgent: meta.userAgent,
    viewportWidth: meta.viewportWidth,
    viewportHeight: meta.viewportHeight,
  });
  return `${PROBLEM_REPORT_META_MARKER}\n${payload}\n===\n${safeDescription}`;
}

export function parseProblemReportComment(
  comment: string | null | undefined,
): ParsedProblemReportComment {
  if (!comment?.trim()) {
    return { description: "", meta: null };
  }

  const trimmed = comment.trim();
  if (!trimmed.startsWith(PROBLEM_REPORT_META_MARKER)) {
    return { description: trimmed, meta: null };
  }

  const lines = trimmed.split("\n");
  const jsonLine = lines[1] ?? "";
  const separatorIndex = lines.findIndex((line, index) => index > 1 && line === "===");
  const description =
    separatorIndex >= 0
      ? lines.slice(separatorIndex + 1).join("\n").trim()
      : lines.slice(2).join("\n").trim();

  try {
    const parsed = JSON.parse(jsonLine) as Partial<ProblemReportClientMeta> & {
      source?: string;
    };
    if (parsed.source !== PROBLEM_REPORT_SOURCE) {
      return { description: description || trimmed, meta: null };
    }
    const meta: ProblemReportStoredMeta = {
      source: PROBLEM_REPORT_SOURCE,
      pagePath: sanitizeProblemReportPagePath(parsed.pagePath),
      userAgent: sanitizeProblemReportUserAgent(parsed.userAgent),
      viewportWidth: sanitizeViewportSize(parsed.viewportWidth),
      viewportHeight: sanitizeViewportSize(parsed.viewportHeight),
    };
    return { description, meta };
  } catch {
    return { description: description || trimmed, meta: null };
  }
}

/** Plain-text sanitize for admin UI / Telegram (no HTML). */
export function sanitizeProblemReportText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}
