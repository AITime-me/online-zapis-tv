import { NextResponse } from "next/server";
import type { CommCampaignStatus } from "@prisma/client";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  getCampaign,
  previewCampaign,
  updateCampaign,
} from "@/services/CommunicationsCampaignService";
import type { CommCampaignButtonInput } from "@/types/communications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const preview = new URL(_request.url).searchParams.get("preview") === "1";

  try {
    if (preview) {
      const data = await previewCampaign(id);
      return NextResponse.json({ ok: true, preview: data });
    }
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: "Рассылка не найдена" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}

type PatchBody = {
  name?: string;
  slug?: string;
  status?: CommCampaignStatus;
  segmentId?: string | null;
  messageText?: string;
  imageUrl?: string | null;
  scheduledAt?: string | null;
  attributionWindowHours?: number;
  buttons?: CommCampaignButtonInput[];
};

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    const campaign = await updateCampaign(id, {
      ...body,
      userId: authResult.user.id,
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
