import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProcedureGiftGameVanilla } from "@/components/game/procedure-gift-game-vanilla";
import { getStudioSettings } from "@/services/StudioSettingsService";
import {
  GameCatalogNotFoundError,
  getGameCatalogBySlug,
  isGameCatalogPubliclyAvailable,
} from "@/services/GameCatalogService";
import { getGameCatalogActivationBlockReason } from "@/types/game-catalog";

export const dynamic = "force-dynamic";

type PromoGamePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PromoGamePageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const game = await getGameCatalogBySlug(slug);
    return {
      title: `${game.title} — Твоё время`,
      description: game.description ?? "Игровая акция студии красоты «Твоё время».",
    };
  } catch {
    return {
      title: "Игра — Твоё время",
    };
  }
}

export default async function PromoGamePage({ params }: PromoGamePageProps) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameCatalogBySlug(slug);
  } catch (error) {
    if (error instanceof GameCatalogNotFoundError) {
      notFound();
    }
    throw error;
  }

  if (!isGameCatalogPubliclyAvailable(game)) {
    const reason =
      getGameCatalogActivationBlockReason(game.type) ??
      "Игра временно недоступна.";

    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">{game.title}</h1>
        <p className="text-sm text-zinc-600">{reason}</p>
        <Link href="/" className="text-sm font-medium text-emerald-800 hover:underline">
          На главную
        </Link>
      </main>
    );
  }

  if (game.type === "catch_time" && game.legacyConfigId) {
    const [config, studioSettings] = await Promise.all([
      prisma.gameConfig.findUnique({ where: { id: game.legacyConfigId } }),
      getStudioSettings(),
    ]);

    if (!studioSettings.isGameEnabled) {
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 py-12 text-center">
          <h1 className="text-xl font-semibold text-zinc-900">Игра временно недоступна</h1>
          <p className="text-sm text-zinc-600">
            Раздел «Поймай своё время» отключён в настройках студии.
          </p>
          <Link href="/" className="text-sm font-medium text-emerald-800 hover:underline">
            На главную
          </Link>
        </main>
      );
    }

    return (
      <ProcedureGiftGameVanilla
        config={
          config
            ? {
                isActive: config.isActive,
                title: config.title,
                description: config.description,
                image: config.image ?? null,
                resultHeaderText: config.resultHeaderText,
                directionLabelText: config.directionLabelText,
                giftLabelText: config.giftLabelText,
                ctaButtonText: config.ctaButtonText,
                managerMessageHeader: config.managerMessageHeader,
                managerMessageFooter: config.managerMessageFooter,
              }
            : null
        }
        vkUrl={studioSettings.vkUrl}
        maxUrl={studioSettings.maxUrl}
        gameSuccessMessage={studioSettings.gameSuccessMessage}
      />
    );
  }

  notFound();
}
