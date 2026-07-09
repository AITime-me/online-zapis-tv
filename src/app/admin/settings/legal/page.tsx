import Link from "next/link";
import { requireAdminSection } from "@/lib/auth/session";
import { LegalDocumentsPanel } from "@/components/admin/legal-documents-panel";
import { listLegalDocumentsForAdmin } from "@/services/LegalDocumentService";
import { SettingsPageHeader } from "../settings-page-header";

export default async function LegalDocumentsAdminPage() {
  const user = await requireAdminSection("system-settings");
  const documents = await listLegalDocumentsForAdmin();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <SettingsPageHeader role={user.role} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Юридические документы</h2>
            <p className="text-sm text-zinc-600">
              Тексты для страниц /privacy, /terms, /consent, /offer и /cookies.
            </p>
          </div>
          <Link
            href="/admin/settings"
            className="text-sm font-medium text-[#1a73e8] hover:underline"
          >
            Настройки студии
          </Link>
        </div>
      </div>

      <LegalDocumentsPanel documents={documents} />
    </main>
  );
}
