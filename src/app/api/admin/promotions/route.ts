import { NextResponse } from "next/server";
import { PROMOTIONS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import {
  createPromotion,
  listPromotionServiceOptions,
  listPromotionsForAdmin,
} from "@/services/PromotionCrudService";
import {
  promotionAdminErrorResponse,
  readPromotionWriteBody,
} from "@/lib/api/promotion-admin-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(PROMOTIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const [promotions, services] = await Promise.all([
      listPromotionsForAdmin(),
      listPromotionServiceOptions(),
    ]);

    return NextResponse.json({ ok: true, promotions, services });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const authResult = await requireApiRoles(PROMOTIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const body = await readPromotionWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  try {
    const promotion = await createPromotion(body);
    return NextResponse.json({ ok: true, promotion });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}
