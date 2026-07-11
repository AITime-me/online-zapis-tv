import { NextResponse } from "next/server";
import { SYSTEM_SETTINGS_ADMIN_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import {
  LegalDocumentValidationError,
  getLegalDocumentForAdmin,
  updateLegalDocument,
} from "@/services/LegalDocumentService";
import type { LegalDocumentWriteInput } from "@/types/legal-document";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(SYSTEM_SETTINGS_ADMIN_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { slug } = await context.params;
  const document = await getLegalDocumentForAdmin(slug);
  if (!document) {
    return NextResponse.json({ ok: false, error: "Документ не найден" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, document });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireProtectedMutatingApi(SYSTEM_SETTINGS_ADMIN_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { slug } = await context.params;

  try {
    const body = (await request.json()) as LegalDocumentWriteInput;
    const document = await updateLegalDocument(slug, body);
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    if (error instanceof LegalDocumentValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
