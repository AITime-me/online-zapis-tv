/**
 * Политика CTA-ссылок для карточек акций (карусель / админка).
 * Разрешены относительные пути сайта и внешние https:// URL.
 */

export const PROMOTION_CTA_LINK_HINT =
  "Адрес перехода по кнопке в карусели. Внутренняя страница: /booking. Внешняя: https://example.ru/…";

export const PROMOTION_CTA_LINK_INVALID_ERROR =
  "Некорректная ссылка кнопки. Укажите путь вида /booking или полный https://… адрес";

export const PROMOTION_CTA_LINK_SCHEME_ERROR =
  "Запрещённая схема ссылки. Разрешены только относительные пути (/…) и https://";

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file|blob|about):/i;

export function normalizePromotionCtaLink(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function isSafePromotionCtaLink(value: string): boolean {
  if (!value || /\s/.test(value) || /[<>"']/.test(value) || value.includes("\\")) {
    return false;
  }

  if (DANGEROUS_SCHEME.test(value)) {
    return false;
  }

  // Protocol-relative //evil.com
  if (value.startsWith("//")) {
    return false;
  }

  // Same-origin relative path
  if (value.startsWith("/")) {
    return value.length > 1 || value === "/";
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === "https:";
}

export function assertSafePromotionCtaLink(
  value: string | null | undefined,
): string | null {
  const normalized = normalizePromotionCtaLink(value);
  if (normalized === null) {
    return null;
  }
  if (DANGEROUS_SCHEME.test(normalized) || normalized.startsWith("//")) {
    throw new Error(PROMOTION_CTA_LINK_SCHEME_ERROR);
  }
  if (!isSafePromotionCtaLink(normalized)) {
    throw new Error(PROMOTION_CTA_LINK_INVALID_ERROR);
  }
  return normalized;
}

export function assertHomepageCtaFields(input: {
  showOnHomepage: boolean;
  ctaText: string | null | undefined;
  ctaLink: string | null | undefined;
}): void {
  if (!input.showOnHomepage) {
    return;
  }
  if (!input.ctaText?.trim()) {
    throw new Error(
      "Для показа на главной заполните текст кнопки (например: Записаться онлайн)",
    );
  }
  const link = assertSafePromotionCtaLink(input.ctaLink);
  if (!link) {
    throw new Error(
      "Для показа на главной укажите ссылку кнопки (например: /booking)",
    );
  }
}
