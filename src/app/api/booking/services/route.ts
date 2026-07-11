import { NextResponse } from "next/server";
import { enforceRequestRateLimit } from "@/lib/security/rate-limit/enforce-policy";
import { listServicesForMaster } from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRequestRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const masterId = new URL(request.url).searchParams.get("masterId");

  if (!masterId) {
    return NextResponse.json(
      { ok: false, error: "masterId is required" },
      { status: 400 },
    );
  }

  const services = await listServicesForMaster(masterId);
  return NextResponse.json({ ok: true, services });
}
