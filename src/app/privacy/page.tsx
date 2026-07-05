import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { privacyPolicy } from "@/content/legal/privacy-policy";

export const metadata = {
  title: "Политика конфиденциальности — Твоё время",
  description: "Политика конфиденциальности студии красоты «Твоё время»",
};

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacyPolicy} />;
}
