import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CommunicationsPanel } from "@/components/admin/communications-panel";
import { getCommunicationsFoundationState } from "@/services/CommunicationsSettingsService";

export default async function CommunicationsAdminPage() {
  const user = await requireAdminSection("communications");
  const foundation = await getCommunicationsFoundationState();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Коммуникации"
        description="Аудитория переписки VK и черновики рассылок. Control plane без реальной отправки сообщений."
        current="communications"
        role={user.role}
      />

      <CommunicationsPanel initialFoundation={foundation} />
    </main>
  );
}
