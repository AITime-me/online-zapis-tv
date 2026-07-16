/**
 * Политика CTA-ссылок для кнопок рассылок.
 * Разрешены внутренние пути /... и https://. Запрещены javascript/data/file/http/protocol-relative.
 */

export const COMM_CTA_LINK_HINT =
  "Только внутренний путь (/booking) или https://…. Схема http:// и javascript: запрещены.";

export const COMM_CTA_LINK_INVALID_ERROR =
  "Некорректная ссылка кнопки. Укажите путь вида /booking или полный https://… адрес";

export const COMM_CTA_LINK_SCHEME_ERROR =
  "Запрещённая схема ссылки. Разрешены только относительные пути (/…) и https://";

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about|http):/i;

export function normalizeCommCtaLink(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function isSafeCommCtaLink(value: string): boolean {
  if (!value || /\s/.test(value) || /[<>"']/.test(value) || value.includes("\\")) {
    return false;
  }

  if (DANGEROUS_SCHEME.test(value)) {
    return false;
  }

  if (value.startsWith("//")) {
    return false;
  }

  if (value.startsWith("/")) {
    return value.length >= 1;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === "https:";
}

export function assertSafeCommCtaLink(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeCommCtaLink(value);
  if (normalized === null) {
    return null;
  }
  if (DANGEROUS_SCHEME.test(normalized) || normalized.startsWith("//")) {
    throw new Error(COMM_CTA_LINK_SCHEME_ERROR);
  }
  if (!isSafeCommCtaLink(normalized)) {
    throw new Error(COMM_CTA_LINK_INVALID_ERROR);
  }
  return normalized;
}

/** Добавляет UTM без PII (без VK ID / телефона / email). */
export function appendCampaignUtmParams(
  targetUrl: string,
  params: {
    campaignSlug: string;
    buttonKey: string;
    utmSource?: string;
    utmMedium?: string;
  },
): string {
  const safe = assertSafeCommCtaLink(targetUrl);
  if (!safe) {
    throw new Error(COMM_CTA_LINK_INVALID_ERROR);
  }

  const utm = {
    utm_source: params.utmSource ?? "vk",
    utm_medium: params.utmMedium ?? "messenger",
    utm_campaign: params.campaignSlug,
    utm_content: params.buttonKey,
  };

  if (safe.startsWith("/")) {
    const url = new URL(safe, "https://example.invalid");
    for (const [key, value] of Object.entries(utm)) {
      url.searchParams.set(key, value);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  const url = new URL(safe);
  for (const [key, value] of Object.entries(utm)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function assertNoPiiInUrl(url: string): void {
  const lower = url.toLowerCase();
  const forbidden = [
    "vk_user_id",
    "channel_user_id",
    "phone",
    "email",
    "peer_id",
  ];
  for (const key of forbidden) {
    if (lower.includes(`${key}=`) || lower.includes(`/${key}/`)) {
      throw new Error("В URL запрещены идентификаторы и персональные данные");
    }
  }
}
