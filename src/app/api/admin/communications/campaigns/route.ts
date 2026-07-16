import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  createCampaign,
  listCampaigns,
} from "@/services/CommunicationsCampaignService";
import type { CommCampaignButtonInput } from "@/types/communications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ ok: true, campaigns });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}

type CreateBody = {
  name?: string;
  slug?: string;
  segmentId?: string | null;
  messageText?: string;
  imageUrl?: string | null;
  attributionWindowHours?: number;
  buttons?: CommCampaignButtonInput[];
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    const campaign = await createCampaign({
      name: body.name ?? "",
      slug: body.slug,
      segmentId: body.segmentId,
      messageText: body.messageText,
      imageUrl: body.imageUrl,
      attributionWindowHours: body.attributionWindowHours,
      buttons: body.buttons,
      userId: authResult.user.id,
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
