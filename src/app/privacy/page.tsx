import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Твоё время",
  description: "Политика конфиденциальности студии красоты «Твоё время»",
};

export default async function PrivacyPage() {
  const document = await loadPublishedLegalDocument("privacy");

  if (!document) {
    return (
      <LegalUnavailablePage title="Политика конфиденциальности" backHref="/booking" />
    );
  }

  return <LegalTextDocumentPage document={document} />;
}
