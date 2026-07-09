import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Пользовательское соглашение | Студия красоты «Твоё время»",
  description:
    "Правила использования сервиса онлайн-записи студии красоты «Твоё время».",
};

export default async function OfferPage() {
  const document = await loadPublishedLegalDocument("offer");

  if (!document) {
    return (
      <LegalUnavailablePage title="Пользовательское соглашение" backHref="/" />
    );
  }

  return <LegalTextDocumentPage document={document} backHref="/" />;
}
