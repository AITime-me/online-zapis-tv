import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toIsoString } from "@/lib/datetime/date-layer";
import { STUDIO_TIMEZONE } from "@/lib/env";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      database: "connected",
      timezone: STUDIO_TIMEZONE,
      timestamp: toIsoString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";

    return NextResponse.json(
      {
        ok: false,
        database: "disconnected",
        error: message,
        timestamp: toIsoString(),
      },
      { status: 503 },
    );
  }
}
