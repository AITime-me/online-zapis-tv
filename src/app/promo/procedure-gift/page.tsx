import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ProcedureGiftGameVanilla } from "@/components/game/procedure-gift-game-vanilla";

export const metadata: Metadata = {
  title: "Поймай своё время — Твоё время",
  description:
    "Пройдите короткую игру — получите направление ухода и подарок, а затем отправьте заявку менеджеру для записи в студию.",
};

export default async function ProcedureGiftPage() {
  const config = await prisma.gameConfig.findUnique({ where: { id: "default" } });

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
    />
  );
}

