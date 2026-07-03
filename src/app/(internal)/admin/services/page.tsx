import { requireRole } from "@/lib/auth/session";
import { AdminNavLinks } from "@/components/admin/admin-nav";
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
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dadce0] bg-white px-4 py-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Услуги</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Справочник услуг для расписания и онлайн-записи
          </p>
        </div>
        <AdminNavLinks current="services" />
      </header>

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
