import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ClientDetailPanel } from "@/components/admin/client-detail-panel";
import { getClientDetailsForAdmin } from "@/services/ClientDetailService";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const user = await requireAdminSection("clients");
  const { id } = await params;
  const details = await getClientDetailsForAdmin(id);

  if (!details) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Клиенты"
        description="Карточка клиента и мини-история CRM."
        current="clients"
        role={user.role}
      />

      <div>
        <Link
          href="/admin/clients"
          className="text-sm font-medium text-[#1a73e8] hover:underline"
        >
          ← К клиентам
        </Link>
      </div>

      <ClientDetailPanel details={details} />
    </main>
  );
}
