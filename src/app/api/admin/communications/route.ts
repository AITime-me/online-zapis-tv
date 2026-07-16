import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import { getCommunicationsFoundationState } from "@/services/CommunicationsSettingsService";

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
