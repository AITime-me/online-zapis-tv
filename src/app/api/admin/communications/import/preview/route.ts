import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  CommunicationsImportValidationError,
  previewSalebotImport,
} from "@/services/CommunicationsImportService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PreviewBody = {
  csvText?: string;
  zipBase64?: string;
  originalFileName?: string;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    const preview = await previewSalebotImport({
      csvText: typeof body.csvText === "string" ? body.csvText : undefined,
      zipBase64: typeof body.zipBase64 === "string" ? body.zipBase64 : undefined,
      originalFileName:
        typeof body.originalFileName === "string" ? body.originalFileName : null,
      createdByUserId: authResult.user.id,
    });
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    if (error instanceof CommunicationsImportValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return communicationsAdminErrorResponse(error);
  }
}
