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
    <header className="relative z-10 shrink-0 border-b border-[#dadce0] bg-white px-4 py-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
          <p className="mt-1 text-sm text-zinc-600">{description}</p>
        </div>
        <AdminNavLinks current={current} role={role} />
      </div>
    </header>
  );
}
