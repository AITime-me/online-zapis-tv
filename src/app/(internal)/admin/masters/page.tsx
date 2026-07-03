import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { MastersPanel } from "@/components/admin/masters-panel";
import { listMasters } from "@/services/MasterAdminService";

export default async function MastersAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const masters = await listMasters(true);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dadce0] bg-white px-4 py-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Мастера</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Справочник мастеров для внутреннего расписания
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href="/schedule"
            className="text-[#1a73e8] hover:underline"
          >
            К расписанию
          </Link>
          <Link
            href="/admin/emergency-export"
            className="text-[#1a73e8] hover:underline"
          >
            Аварийная выгрузка
          </Link>
        </div>
      </header>

      <MastersPanel initialMasters={masters} />
    </main>
  );
}
