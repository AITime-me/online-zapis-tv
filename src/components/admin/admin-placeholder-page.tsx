import { AdminPageHeader } from "@/components/admin/admin-page-header";
import type { AdminNavCurrent } from "@/components/admin/admin-nav";
import type { UserRole } from "@prisma/client";

type AdminPlaceholderPageProps = {
  title: string;
  description: string;
  current: AdminNavCurrent;
  role: UserRole;
  notice: string;
};

export function AdminPlaceholderPage({
  title,
  description,
  current,
  role,
  notice,
}: AdminPlaceholderPageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title={title}
        description={description}
        current={current}
        role={role}
      />

      <section className="rounded border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {notice}
      </section>
    </main>
  );
}
