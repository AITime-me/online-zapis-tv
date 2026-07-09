import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Согласие на обработку персональных данных — Твоё время",
  description:
    "Согласие на обработку персональных данных студии красоты «Твоё время»",
};

export default async function ConsentPage() {
  const document = await loadPublishedLegalDocument("consent");

  if (!document) {
    return (
      <LegalUnavailablePage
        title="Согласие на обработку персональных данных"
        backHref="/"
      />
    );
  }

  return <LegalTextDocumentPage document={document} backHref="/" />;
}
