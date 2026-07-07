import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { userAgreement } from "@/content/legal/user-agreement";

export const metadata = {
  title: "Пользовательское соглашение | Студия красоты «Твоё время»",
  description:
    "Правила использования сервиса онлайн-записи студии красоты «Твоё время».",
};

export default function OfferPage() {
  return <LegalDocumentPage document={userAgreement} backHref="/" />;
}
