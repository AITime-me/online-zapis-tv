import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { GamePanel } from "@/components/admin/game-panel";
import { getGameAdminPageData } from "@/services/GameAdminService";

export default async function GameAdminPage() {
  const user = await requireAdminSection("game");

  const { config, gifts } = await getGameAdminPageData();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Игра «Поймай своё время»"
        description="Настройки игры, подарки, вероятности, тексты, изображения и правила доступности."
        current="game"
        role={user.role}
      />

      <GamePanel initialConfig={config} initialGifts={gifts} />
    </main>
  );
}
