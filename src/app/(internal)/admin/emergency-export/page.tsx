import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { EmergencyExportPanel } from "@/components/admin/emergency-export-panel";
import { emergencyExportService } from "@/services/EmergencyExportService";

export default async function EmergencyExportAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const latest = await emergencyExportService.getLatestStatus();
  const latestSuccessful = await emergencyExportService.getLatestSuccessful();

  const initialStatus = {
    ok: true,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          createdAt: latest.createdAt.toISOString(),
          fileName: latest.filePath
            ? latest.filePath.split(/[/\\]/).pop() ?? null
            : null,
          errorMessage: latest.errorMessage,
          downloadUrl:
            latest.status === "SUCCESS"
              ? `/api/emergency-export/${latest.id}/download`
              : null,
        }
      : null,
    latestSuccessful: latestSuccessful
      ? {
          id: latestSuccessful.id,
          status: latestSuccessful.status,
          createdAt: latestSuccessful.createdAt.toISOString(),
          fileName: latestSuccessful.filePath
            ? latestSuccessful.filePath.split(/[/\\]/).pop() ?? null
            : null,
          errorMessage: latestSuccessful.errorMessage,
          downloadUrl: `/api/emergency-export/${latestSuccessful.id}/download`,
        }
      : null,
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dadce0] bg-white px-4 py-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Аварийная выгрузка</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Локальная XLSX-выгрузка расписания на сегодня
          </p>
        </div>
        <Link href="/schedule" className="text-sm text-[#1a73e8] hover:underline">
          К расписанию
        </Link>
      </header>

      <EmergencyExportPanel initialStatus={initialStatus} />
    </main>
  );
}
