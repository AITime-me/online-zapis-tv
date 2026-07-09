import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ClientDuplicatesPanel } from "@/components/admin/client-duplicates-panel";

export default async function ClientDuplicatesAdminPage() {
  const user = await requireAdminSection("clients");

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Возможные дубли клиентов"
        description="Клиенты, которые могут быть одной и той же персоной. На этом этапе доступен только разбор, без объединения."
        current="clients"
        role={user.role}
      />

      <ClientDuplicatesPanel />
    </main>
  );
}
