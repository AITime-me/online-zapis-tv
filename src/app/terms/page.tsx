import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Публичная оферта — Твоё время",
  description: "Публичная оферта студии красоты «Твоё время»",
};

export default async function TermsPage() {
  const document = await loadPublishedLegalDocument("terms");

  if (!document) {
    return <LegalUnavailablePage title="Публичная оферта" backHref="/booking" />;
  }

  return <LegalTextDocumentPage document={document} />;
}
