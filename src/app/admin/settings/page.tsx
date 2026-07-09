import { requireAdminSection } from "@/lib/auth/session";
import { StudioSettingsPanel } from "@/components/admin/studio-settings-panel";
import { getStudioSettings } from "@/services/StudioSettingsService";
import { SettingsPageHeader } from "./settings-page-header";

export default async function SystemSettingsAdminPage() {
  const user = await requireAdminSection("system-settings");
  const settings = await getStudioSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <SettingsPageHeader role={user.role} />

      <StudioSettingsPanel initialSettings={settings} />
    </main>
  );
}
