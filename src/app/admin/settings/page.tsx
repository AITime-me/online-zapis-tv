import { requireAdminSection } from "@/lib/auth/session";
import { AdminPlaceholderPage } from "@/components/admin/admin-placeholder-page";

export default async function SystemSettingsAdminPage() {
  const user = await requireAdminSection("system-settings");

  return (
    <AdminPlaceholderPage
      title="Настройки системы"
      description="Глобальные параметры студии и сервиса онлайн-записи."
      current="settings"
      role={user.role}
      notice="Раздел доступен только владельцу. Операционные настройки студии для менеджера остаются в расписании, заявках, мастерах и услугах."
    />
  );
}
