import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MastersPanel } from "@/components/admin/masters-panel";
import { listMasters } from "@/services/MasterAdminService";

export default async function MastersAdminPage() {
  const user = await requireAdminSection("masters");

  const masters = await listMasters(true);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Мастера"
        description="Справочник мастеров для внутреннего расписания"
        current="masters"
        role={user.role}
      />

      <MastersPanel initialMasters={masters} />
    </main>
  );
}
