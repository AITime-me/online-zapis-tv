import type { UserRole } from "@prisma/client";
import { AdminNavLinks, type AdminNavCurrent } from "@/components/admin/admin-nav";

type AdminPageHeaderProps = {
  title: string;
  description: string;
  current: AdminNavCurrent;
  role: UserRole;
};

export function AdminPageHeader({
  title,
  description,
  current,
  role,
}: AdminPageHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[#dadce0] bg-white px-4 py-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">{description}</p>
        </div>
        <div className="min-w-0 lg:flex lg:justify-end">
          <AdminNavLinks current={current} role={role} />
        </div>
      </div>
    </header>
  );
}
