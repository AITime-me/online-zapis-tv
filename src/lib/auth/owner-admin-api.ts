import { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { requireApiRoles } from "@/lib/auth/api-access";

export function createOwnerAdminApiHandler(allowedRoles: UserRole[]) {
  return async function GET() {
    const authResult = await requireApiRoles(allowedRoles);
    if ("response" in authResult) {
      return authResult.response;
    }

    return NextResponse.json({
      ok: true,
      ready: false,
      message: "Раздел подготовлен. Полная админка будет подключена отдельным этапом.",
    });
  };
}
