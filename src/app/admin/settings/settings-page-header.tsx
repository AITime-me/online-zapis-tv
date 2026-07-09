import type { UserRole } from "@prisma/client";
import { AdminNavLinks } from "@/components/admin/admin-nav";

type SettingsPageHeaderProps = {
  role: UserRole;
};

export function SettingsPageHeader({ role }: SettingsPageHeaderProps) {
  return (
    <header className="relative z-10 shrink-0 border-b border-[#dadce0] bg-white px-4 py-3 md:px-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900">Настройки</h1>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">
            Данные студии, каналы связи, юридические ссылки и системные параметры
          </p>
        </div>
        <div className="min-w-0 lg:flex lg:justify-end">
          <AdminNavLinks current="settings" role={role} />
        </div>
      </div>
    </header>
  );
}
