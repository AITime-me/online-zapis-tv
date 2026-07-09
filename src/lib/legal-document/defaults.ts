import { personalDataConsent } from "@/content/legal/personal-data-consent";
import { privacyPolicy } from "@/content/legal/privacy-policy";
import { termsOfService } from "@/content/legal/terms-of-service";
import { userAgreement } from "@/content/legal/user-agreement";
import { serializeLegalDocumentContent } from "@/lib/legal-document/serialize";

export const SYSTEM_LEGAL_DOCUMENT_SLUGS = [
  "privacy",
  "terms",
  "consent",
  "offer",
  "cookies",
] as const;

export type SystemLegalDocumentSlug = (typeof SYSTEM_LEGAL_DOCUMENT_SLUGS)[number];

export function isSystemLegalDocumentSlug(
  slug: string,
): slug is SystemLegalDocumentSlug {
  return SYSTEM_LEGAL_DOCUMENT_SLUGS.includes(slug as SystemLegalDocumentSlug);
}

const COOKIES_POLICY_CONTENT = `1. Что такое cookie

Cookie — небольшие текстовые файлы, которые сохраняются в браузере при посещении сайта. Они помогают сайту запоминать настройки и обеспечивать корректную работу сервисов.

2. Какие cookie мы используем

• технические cookie, необходимые для работы сайта и онлайн-записи;
• cookie, сохраняющие выбор пользователя (например, согласие на использование cookie);
• аналитические cookie в обезличенном виде — только если они подключены и не позволяют идентифицировать пользователя без дополнительных данных.

3. Цели использования

• обеспечение стабильной работы сайта;
• сохранение пользовательских настроек;
• улучшение удобства сервиса онлайн-записи.

4. Управление cookie

Вы можете удалить cookie в настройках браузера или отказаться от их использования. В этом случае часть функций сайта может работать ограниченно.

5. Контакты

ИП Кузнецова Светлана Викторовна
ИНН 450144605881
ОГРНИП 324450000034680
Тел: 8 912 979-30-90
Email: ipku82@bk.ru
Адрес: г. Курган, ул. Володарского, 30`;

export const LEGAL_DOCUMENT_SEEDS = [
  {
    slug: "privacy",
    title: "Политика конфиденциальности",
    content: serializeLegalDocumentContent(privacyPolicy),
    isPublished: true,
  },
  {
    slug: "terms",
    title: "Публичная оферта",
    content: serializeLegalDocumentContent(termsOfService),
    isPublished: true,
  },
  {
    slug: "consent",
    title: "Согласие на обработку персональных данных",
    content: serializeLegalDocumentContent(personalDataConsent),
    isPublished: true,
  },
  {
    slug: "offer",
    title: "Пользовательское соглашение",
    content: serializeLegalDocumentContent(userAgreement),
    isPublished: true,
  },
  {
    slug: "cookies",
    title: "Политика использования cookie",
    content: COOKIES_POLICY_CONTENT,
    isPublished: true,
  },
] as const;
