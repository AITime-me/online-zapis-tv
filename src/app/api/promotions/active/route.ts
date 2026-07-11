import { NextResponse } from "next/server";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { listActivePromotions } from "@/services/PromotionCrudService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const promotions = await listActivePromotions();
  return NextResponse.json({ ok: true, promotions });
}
