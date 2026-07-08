import { NextResponse } from "next/server";
import { listActivePromotions } from "@/services/PromotionCrudService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const promotions = await listActivePromotions();
  return NextResponse.json({ ok: true, promotions });
}
