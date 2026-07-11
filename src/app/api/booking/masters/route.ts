import { NextResponse } from "next/server";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import {
  listBookableMasters,
  listMastersForService,
} from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const serviceId = new URL(request.url).searchParams.get("serviceId");

  if (!serviceId) {
    const masters = await listBookableMasters();
    return NextResponse.json({ ok: true, masters });
  }

  const masters = await listMastersForService(serviceId);
  return NextResponse.json({ ok: true, masters });
}
