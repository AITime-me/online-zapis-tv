import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { GamePanel } from "@/components/admin/game-panel";
import { getGameAdminPageData } from "@/services/GameAdminService";
import {
  GameCatalogNotFoundError,
  getGameCatalogById,
} from "@/services/GameCatalogService";
import {
  GAME_CATALOG_STATUS_LABELS,
  GAME_CATALOG_TYPE_LABELS,
  getGameCatalogActivationBlockReason,
} from "@/types/game-catalog";

type GameDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function GameDetailAdminPage({ params }: GameDetailPageProps) {
  const user = await requireAdminSection("game");
  const { id } = await params;

  let game;
  try {
    game = await getGameCatalogById(id);
  } catch (error) {
    if (error instanceof GameCatalogNotFoundError) {
      notFound();
    }
    throw error;
  }

  const blockReason = getGameCatalogActivationBlockReason(game.type);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title={game.title}
        description={`${GAME_CATALOG_TYPE_LABELS[game.type]} · ${GAME_CATALOG_STATUS_LABELS[game.status]} · ${game.publicPath}`}
        current="games"
        role={user.role}
      />

      <p className="text-sm text-zinc-600">
        <Link href="/admin/games" className="text-[#1a73e8] hover:underline">
          ← К списку игр
        </Link>
      </p>

      <section className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <p>
          Публичная ссылка:{" "}
          <code className="rounded bg-zinc-100 px-2 py-1 text-xs">{game.publicUrl}</code>
        </p>
        {game.externalUrl ? (
          <p className="mt-2">Внешняя ссылка (опционально): {game.externalUrl}</p>
        ) : null}
        {blockReason ? (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {blockReason}
          </p>
        ) : null}
      </section>

      {game.type === "catch_time" && game.legacyConfigId ? (
        <CatchTimeEditor gameCatalogId={game.id} />
      ) : (
        <section className="rounded border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
          Для этого типа игры пока нет редактора механики. Игра может существовать
          только как черновик до подключения renderer.
        </section>
      )}
    </main>
  );
}

async function CatchTimeEditor({ gameCatalogId }: { gameCatalogId: string }) {
  const { config, gifts } = await getGameAdminPageData(gameCatalogId);
  return (
    <GamePanel
      gameCatalogId={gameCatalogId}
      initialConfig={config}
      initialGifts={gifts}
    />
  );
}
