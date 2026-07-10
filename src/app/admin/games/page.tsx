import Link from "next/link";
import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { GamesCatalogPanel } from "@/components/admin/games-catalog-panel";
import { listGameCatalog } from "@/services/GameCatalogService";

export const dynamic = "force-dynamic";

export default async function GamesAdminPage() {
  const user = await requireAdminSection("game");
  const games = await listGameCatalog();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Игры"
        description="Каталог игровых механик студии: публичные ссылки, статусы и настройки."
        current="games"
        role={user.role}
      />

      <GamesCatalogPanel initialGames={games} />
    </main>
  );
}
