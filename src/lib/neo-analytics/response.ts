import { NextResponse } from "next/server";

const SOURCE_ID = "online-zapis-tv-production";
const SCHEMA_VERSION = "1.0";

export function analyticsResponse<T>(
  schema: Record<string, string>,
  rows: T[],
): NextResponse {
  return NextResponse.json({
    sourceId: SOURCE_ID,
    fetchedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    schema,
    status: rows.length === 0 ? "EMPTY" : "OK",
    rowCount: rows.length,
    rows,
  });
}

export function badRequest(error: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "BAD_REQUEST", error },
    { status: 400 },
  );
}
