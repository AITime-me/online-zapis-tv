import Link from "next/link";
import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { GameCatalogCreateForm } from "@/components/admin/game-catalog-create-form";

export default async function NewGameAdminPage() {
  const user = await requireAdminSection("game");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Добавить игру"
        description="Создайте новую игру в каталоге. Публичный URL формируется автоматически из slug."
        current="games"
        role={user.role}
      />

      <p className="text-sm text-zinc-600">
        <Link href="/admin/games" className="text-[#1a73e8] hover:underline">
          ← К списку игр
        </Link>
      </p>

      <GameCatalogCreateForm />
    </main>
  );
}
