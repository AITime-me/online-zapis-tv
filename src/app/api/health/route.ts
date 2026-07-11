import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toIsoString } from "@/lib/datetime/date-layer";
import {
  buildHealthErrorResponse,
  buildHealthSuccessResponse,
} from "@/lib/health/health-response";

export async function GET() {
  const timestamp = toIsoString();
  const isProduction = process.env.NODE_ENV === "production";

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(buildHealthSuccessResponse(timestamp));
  } catch (error) {
    console.error("[health] database check failed");

    return NextResponse.json(
      buildHealthErrorResponse(isProduction, timestamp, error),
      { status: 503 },
    );
  }
}
