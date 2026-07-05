import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

/**
 * Явный endpoint для SessionProvider — всегда JSON, никогда HTML/404.
 * Формат совместим с next-auth/react: Session | null.
 */
export async function GET() {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    return NextResponse.json(session ?? null, { headers: JSON_HEADERS });
  } catch (error) {
    console.error("[GET /api/auth/session]", error);
    return NextResponse.json(null, { status: 200, headers: JSON_HEADERS });
  }
}
