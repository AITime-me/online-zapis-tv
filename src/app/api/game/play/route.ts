import { NextResponse } from "next/server";
import {
  validateGamePlayBody,
  type GamePlayRequestBody,
} from "@/lib/game/play-contract";
import { createGamePlayAndSelectGift } from "@/services/GamePlayService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GamePlayRequestBody;
    const validation = validateGamePlayBody(body);

    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, error: validation.error },
        { status: 400 },
      );
    }

    const { playId, gift } = await createGamePlayAndSelectGift(validation.data);

    return NextResponse.json({ ok: true, playId, gift });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Некорректный JSON в теле запроса" },
        { status: 400 },
      );
    }

    console.error("[POST /api/game/play]", error);
    return NextResponse.json(
      { ok: false, error: "Не удалось обработать результат игры" },
      { status: 500 },
    );
  }
}
