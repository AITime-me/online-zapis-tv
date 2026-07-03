import { requireAuth } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/logout-button";

export default async function SchedulePage() {
  const user = await requireAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Расписание</h1>
          <p className="mt-2 text-zinc-600">Внутренняя зона доступна</p>
        </div>
        <LogoutButton />
      </header>

      <section className="rounded border border-zinc-200 p-4">
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="font-medium text-zinc-500">Пользователь</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500">Роль</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
