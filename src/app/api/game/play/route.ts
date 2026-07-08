import { NextResponse } from "next/server";
import { createGamePlayAndSelectGift } from "@/services/GamePlayService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PlayBody = {
  gameDirection?: string;
  skinNeed?: string;
  resultType?: string;
  premiumLevel?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as PlayBody;
  const gameDirection =
    typeof body.gameDirection === "string" ? body.gameDirection.trim() : "";
  const skinNeed = typeof body.skinNeed === "string" ? body.skinNeed.trim() : "";
  const resultType =
    typeof body.resultType === "string" ? body.resultType.trim() : "";
  const premiumLevel =
    typeof body.premiumLevel === "number" && Number.isFinite(body.premiumLevel)
      ? Math.trunc(body.premiumLevel)
      : 0;

  if (!gameDirection || !skinNeed || !resultType) {
    return NextResponse.json(
      { ok: false, error: "gameDirection, skinNeed и resultType обязательны" },
      { status: 400 },
    );
  }

  const { playId, gift } = await createGamePlayAndSelectGift({
    gameDirection,
    skinNeed,
    resultType,
    premiumLevel,
  });

  return NextResponse.json({ ok: true, playId, gift });
}

