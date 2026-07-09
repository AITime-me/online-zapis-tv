import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { UsersPanel } from "@/components/admin/users-panel";
import { listUsersForAdmin } from "@/services/UserAdminService";

export default async function UsersAdminPage() {
  const user = await requireAdminSection("users");
  const users = await listUsersForAdmin();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Пользователи"
        description="Доступы сотрудников, роли и подготовка к CRM-системе"
        current="users"
        role={user.role}
      />

      <UsersPanel initialUsers={users} />
    </main>
  );
}
