import { NextResponse } from "next/server";
import { getBookingCatalog } from "@/services/BookingService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const catalog = await getBookingCatalog();
  return NextResponse.json({ ok: true, ...catalog });
}
