import { NextResponse } from "next/server";
import { CLIENTS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import { getClientDetailsForAdmin } from "@/services/ClientDetailService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(CLIENTS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const details = await getClientDetailsForAdmin(id);
    if (!details) {
      return NextResponse.json({ ok: false, error: "Клиент не найден" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, details });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось загрузить карточку клиента" },
      { status: 500 },
    );
  }
}
