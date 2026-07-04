import { NextResponse } from "next/server";
import { listMastersForService } from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const serviceId = new URL(request.url).searchParams.get("serviceId");

  if (!serviceId) {
    return NextResponse.json(
      { ok: false, error: "serviceId is required" },
      { status: 400 },
    );
  }

  const masters = await listMastersForService(serviceId);
  return NextResponse.json({ ok: true, masters });
}
