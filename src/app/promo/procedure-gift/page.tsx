import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ProcedureGiftGameVanilla } from "@/components/game/procedure-gift-game-vanilla";
import { getStudioSettings } from "@/services/StudioSettingsService";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Поймай своё время — Твоё время",
  description:
    "Пройдите короткую игру — получите направление ухода и подарок, а затем отправьте заявку менеджеру для записи в студию.",
};

export default async function ProcedureGiftPage() {
  const [config, studioSettings] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: "default" } }),
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
