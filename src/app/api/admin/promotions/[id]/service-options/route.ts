import { NextResponse } from "next/server";
import {
  PROMOTIONS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { promotionAdminErrorResponse } from "@/lib/api/promotion-admin-route";
import {
  getPromotionById,
  listPromotionServiceOptionsForEdit,
} from "@/services/PromotionCrudService";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Каталог услуг для формы акции: активные + уже привязанные (с пометкой). */
export async function GET(_: Request, context: RouteContext) {
  const authResult = await requireApiRoles(PROMOTIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const promotion = await getPromotionById(id);
    const services = await listPromotionServiceOptionsForEdit(
      promotion.serviceIds,
    );
    return NextResponse.json({ ok: true, services });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}
