import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import { requestTestSend } from "@/services/CommunicationsCampaignService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  let body: { confirmed?: boolean };
  try {
    body = (await request.json()) as { confirmed?: boolean };
  } catch {
    body = {};
  }

  try {
    const result = await requestTestSend({
      campaignId: id,
      confirmed: Boolean(body.confirmed),
      userId: authResult.user.id,
    });
    return NextResponse.json({
      ok: false,
      error: result.errorMessage,
      errorCode: result.errorCode,
      attemptId: result.attemptId,
    }, { status: 400 });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
