import { NextResponse } from "next/server";
import { getPublicStudioSettings } from "@/services/StudioSettingsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const settings = await getPublicStudioSettings();
  return NextResponse.json({ ok: true, settings });
}
