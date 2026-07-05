import { AdminNavLinks, type AdminNavCurrent } from "@/components/admin/admin-nav";

type AdminPageHeaderProps = {
  title: string;
  description: string;
  current: AdminNavCurrent;
};

export function AdminPageHeader({
  title,
  description,
  current,
}: AdminPageHeaderProps) {
  return (
    <header className="relative z-10 flex flex-col gap-4 border-b border-[#dadce0] bg-white px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
        <p className="mt-1 text-sm text-zinc-600">{description}</p>
      </div>
      <AdminNavLinks current={current} />
    </header>
  );
}
