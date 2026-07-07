import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmergencyExportPanel } from "@/components/admin/emergency-export-panel";
import { emergencyExportService } from "@/services/EmergencyExportService";

export default async function EmergencyExportAdminPage() {
  const user = await requireAdminSection("emergency-export");

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
      <AdminPageHeader
        title="Аварийная выгрузка"
        description="Локальная XLSX-выгрузка расписания на сегодня"
        current="export"
        role={user.role}
      />

      <EmergencyExportPanel initialStatus={initialStatus} />
    </main>
  );
}
