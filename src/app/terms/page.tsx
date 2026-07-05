import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { termsOfService } from "@/content/legal/terms-of-service";

export const metadata = {
  title: "Публичная оферта — Твоё время",
  description: "Публичная оферта студии красоты «Твоё время»",
};

export default function TermsPage() {
  return <LegalDocumentPage document={termsOfService} />;
}
