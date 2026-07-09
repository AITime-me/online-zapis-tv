import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ClientsPanel } from "@/components/admin/clients-panel";
import { listClientsForAdmin } from "@/services/ClientAdminService";

type ClientsAdminPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function ClientsAdminPage({
  searchParams,
}: ClientsAdminPageProps) {
  const user = await requireAdminSection("clients");
  const clients = await listClientsForAdmin();
  const params = await searchParams;
  const initialSearch = typeof params.q === "string" ? params.q : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Клиенты"
        description="База клиентов и фундамент будущей CRM: заявки, история общения, подарки и лояльность."
        current="clients"
        role={user.role}
      />

      <ClientsPanel initialClients={clients} initialSearch={initialSearch} />
    </main>
  );
}
