import { requireRole } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ServicesPanel } from "@/components/admin/services-panel";
import { getServiceAdminPageData } from "@/services/ServiceAdminService";

export default async function ServicesAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const {
    services,
    filterCategories,
    filterMasters,
    formCategories,
    formMasters,
  } = await getServiceAdminPageData();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Услуги"
        description="Справочник услуг для расписания и онлайн-записи"
        current="services"
      />

      <ServicesPanel
        initialServices={services}
        initialFilterCategories={filterCategories}
        initialFilterMasters={filterMasters}
        initialFormCategories={formCategories}
        initialFormMasters={formMasters}
      />
    </main>
  );
}
