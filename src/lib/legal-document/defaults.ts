/** Системные slug юридических документов (без юридических текстов). */

export const SYSTEM_LEGAL_DOCUMENT_SLUGS = [
  "privacy",
  "terms",
  "consent",
  "offer",
  "cookies",
  "promotions-game-rules",
  "marketing-consent",
] as const;

export type SystemLegalDocumentSlug = (typeof SYSTEM_LEGAL_DOCUMENT_SLUGS)[number];

/** Документы, без published-версии которых публичные формы fail-closed. */
export const REQUIRED_PUBLISHED_LEGAL_SLUGS = [
  "privacy",
  "consent",
  "terms",
  "offer",
  "cookies",
  "promotions-game-rules",
] as const;

export type RequiredPublishedLegalSlug =
  (typeof REQUIRED_PUBLISHED_LEGAL_SLUGS)[number];

/** Не блокирует запуск, пока рассылки выключены. */
export const OPTIONAL_LAUNCH_LEGAL_SLUGS = ["marketing-consent"] as const;

export const LEGAL_DOCUMENT_PUBLIC_PATHS: Record<SystemLegalDocumentSlug, string | null> = {
  privacy: "/privacy",
  terms: "/terms",
  consent: "/consent",
  offer: "/offer",
  cookies: "/cookies",
  "promotions-game-rules": "/rules/promotions-game",
  "marketing-consent": null,
};

export const LEGAL_DOCUMENT_ADMIN_TITLES: Record<SystemLegalDocumentSlug, string> = {
  privacy: "Политика обработки персональных данных",
  terms: "Публичная оферта",
  consent: "Согласие на обработку персональных данных",
  offer: "Пользовательское соглашение",
  cookies: "Политика использования cookies",
  "promotions-game-rules": "Правила акций, игры и подарков",
  "marketing-consent": "Согласие на рекламные и информационные сообщения",
};

/**
 * Seed metadata only: slug + admin title + public path.
 * No legal body text. Never marks documents as published.
 */
export const LEGAL_DOCUMENT_SEED_METADATA = SYSTEM_LEGAL_DOCUMENT_SLUGS.map(
  (slug) => ({
    slug,
    title: LEGAL_DOCUMENT_ADMIN_TITLES[slug],
    publicPath: LEGAL_DOCUMENT_PUBLIC_PATHS[slug],
  }),
);

/** @deprecated Use LEGAL_DOCUMENT_SEED_METADATA — kept alias for plan imports. */
export const LEGAL_DOCUMENT_SEEDS = LEGAL_DOCUMENT_SEED_METADATA;

export function isSystemLegalDocumentSlug(
  slug: string,
): slug is SystemLegalDocumentSlug {
  return SYSTEM_LEGAL_DOCUMENT_SLUGS.includes(slug as SystemLegalDocumentSlug);
}

export function isRequiredPublishedLegalSlug(
  slug: string,
): slug is RequiredPublishedLegalSlug {
  return REQUIRED_PUBLISHED_LEGAL_SLUGS.includes(
    slug as RequiredPublishedLegalSlug,
  );
}
