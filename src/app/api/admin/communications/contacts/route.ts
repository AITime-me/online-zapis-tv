import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import { parseCommContactListQuery } from "@/lib/communications/list-query";
import { listCommunicationContacts } from "@/services/CommunicationsAudienceService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authResult = await requireApiRoles(COMMUNICATIONS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = parseCommContactListQuery(searchParams);
    const result = await listCommunicationContacts(query);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return communicationsAdminErrorResponse(error);
  }
}
