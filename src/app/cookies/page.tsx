import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Политика использования cookie — Твоё время",
  description: "Политика использования cookie студии красоты «Твоё время»",
};

export default async function CookiesPage() {
  const document = await loadPublishedLegalDocument("cookies");

  if (!document) {
    return (
      <LegalUnavailablePage title="Политика использования cookie" backHref="/" />
    );
  }

  return <LegalTextDocumentPage document={document} backHref="/" />;
}
