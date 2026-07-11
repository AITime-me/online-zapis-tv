import { NextResponse } from "next/server";
import { PROMOTIONS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  archivePromotion,
  getPromotionById,
  updatePromotion,
} from "@/services/PromotionCrudService";
import {
  promotionAdminErrorResponse,
  readPromotionWriteBody,
} from "@/lib/api/promotion-admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, context: RouteContext) {
  const authResult = await requireApiRoles(PROMOTIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const promotion = await getPromotionById(id);
    return NextResponse.json({ ok: true, promotion });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(PROMOTIONS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const body = await readPromotionWriteBody(request);
  if (body instanceof NextResponse) {
    return body;
  }

  try {
    const promotion = await updatePromotion(id, body);
    return NextResponse.json({ ok: true, promotion });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(PROMOTIONS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;

  try {
    const promotion = await archivePromotion(id);
    return NextResponse.json({ ok: true, promotion });
  } catch (error) {
    return promotionAdminErrorResponse(error);
  }
}
