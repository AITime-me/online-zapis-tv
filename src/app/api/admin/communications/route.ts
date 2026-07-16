import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  getCommunicationsFoundationState,
  updateCommunicationSettings,
} from "@/services/CommunicationsSettingsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const state = await getCommunicationsFoundationState();
    return NextResponse.json({ ok: true, ...state });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: { testContactId?: string | null };
  try {
    body = (await request.json()) as { testContactId?: string | null };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    await updateCommunicationSettings({
      testContactId: body.testContactId,
    });
    const state = await getCommunicationsFoundationState();
    return NextResponse.json({ ok: true, ...state });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
