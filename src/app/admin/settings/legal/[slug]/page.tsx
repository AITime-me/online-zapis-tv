import { notFound } from "next/navigation";
import { requireAdminSection } from "@/lib/auth/session";
import { LegalDocumentEditor } from "@/components/admin/legal-document-editor";
import { getLegalDocumentForAdmin } from "@/services/LegalDocumentService";
import { SettingsPageHeader } from "../../settings-page-header";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function LegalDocumentEditPage({ params }: PageProps) {
  const user = await requireAdminSection("system-settings");
  const { slug } = await params;
  const document = await getLegalDocumentForAdmin(slug);

  if (!document) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <SettingsPageHeader role={user.role} />

      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Редактирование документа</h2>
        <p className="text-sm text-zinc-600">{document.title}</p>
      </div>

      <LegalDocumentEditor initialDocument={document} />
    </main>
  );
}
