import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { personalDataConsent } from "@/content/legal/personal-data-consent";

export const metadata = {
  title: "Согласие на обработку персональных данных | Студия красоты «Твоё время»",
  description:
    "Согласие на обработку персональных данных при использовании сервиса онлайн-записи студии красоты «Твоё время».",
};

export default function ConsentPage() {
  return <LegalDocumentPage document={personalDataConsent} backHref="/" />;
}
