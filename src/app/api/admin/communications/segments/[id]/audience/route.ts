import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import { getSegmentAudienceBreakdown } from "@/services/CommunicationsAudienceBreakdownService";

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
    const breakdown = await getSegmentAudienceBreakdown(id);
    return NextResponse.json({ ok: true, audience: breakdown });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
