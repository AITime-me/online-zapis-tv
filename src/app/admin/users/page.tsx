import { requireAdminSection } from "@/lib/auth/session";
import { AdminPlaceholderPage } from "@/components/admin/admin-placeholder-page";

export default async function UsersAdminPage() {
  const user = await requireAdminSection("users");

  return (
    <AdminPlaceholderPage
      title="Пользователи"
      description="Создание учётных записей, назначение ролей и управление доступом."
      current="users"
      role={user.role}
      notice="Раздел доступен только владельцу. Менеджер не может создавать пользователей, менять роли или права доступа."
    />
  );
}
