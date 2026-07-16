import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import { checkCampaign } from "@/services/CommunicationsCampaignService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  try {
    const result = await checkCampaign(id);
    return NextResponse.json({ ok: true, check: result });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
