import { NextResponse } from "next/server";
import {
  SYSTEM_SETTINGS_ADMIN_ROLES,
  requireApiRoles,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import {
  LegalDocumentValidationError,
  createDraftFromPublished,
  getLegalDocumentForAdmin,
  getLegalDocumentsReadiness,
  publishLegalDocumentDraft,
  saveLegalDocumentDraft,
} from "@/services/LegalDocumentService";
import type { LegalDocumentDraftWriteInput } from "@/types/legal-document";

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
  const authResult = await requireProtectedMutatingApi(
    SYSTEM_SETTINGS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  const { slug } = await context.params;

  try {
    const body = (await request.json()) as LegalDocumentDraftWriteInput & {
      action?: "save-draft" | "publish" | "create-draft-from-published";
    };

    const action = body.action ?? "save-draft";
    let document;

    if (action === "publish") {
      document = await publishLegalDocumentDraft(slug, authResult.user.id);
    } else if (action === "create-draft-from-published") {
      document = await createDraftFromPublished(slug, authResult.user.id);
    } else {
      document = await saveLegalDocumentDraft(
        slug,
        {
          title: body.title,
          content: body.content,
        },
        authResult.user.id,
      );
    }

    return NextResponse.json({ ok: true, document });
  } catch (error) {
    if (error instanceof LegalDocumentValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
