import { NextResponse } from "next/server";
import { SYSTEM_SETTINGS_ADMIN_ROLES, requireApiRoles } from "@/lib/auth/api-access";
import { listLegalDocumentsForAdmin } from "@/services/LegalDocumentService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const authResult = await requireApiRoles(SYSTEM_SETTINGS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const documents = await listLegalDocumentsForAdmin();
  return NextResponse.json({ ok: true, documents });
}
