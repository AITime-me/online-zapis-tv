import type { Metadata } from "next";
import {
  LegalTextDocumentPage,
  LegalUnavailablePage,
} from "@/components/legal/legal-text-document-page";
import { loadPublishedLegalDocument } from "@/lib/legal-document/load-published";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Правила акций, игры и подарков — Твоё время",
  description: "Правила акций, игры и подарков студии красоты «Твоё время»",
};

export default async function PromotionsGameRulesPage() {
  const document = await loadPublishedLegalDocument("promotions-game-rules");

  if (!document) {
    return (
      <LegalUnavailablePage
        title="Правила акций, игры и подарков"
        backHref="/"
      />
    );
  }

  return <LegalTextDocumentPage document={document} backHref="/" />;
}
