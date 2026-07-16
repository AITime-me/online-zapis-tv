import { NextResponse } from "next/server";
import {
  COMMUNICATIONS_ADMIN_ROLES,
  requireProtectedMutatingApi,
} from "@/lib/auth/api-access";
import { communicationsAdminErrorResponse } from "@/lib/api/communications-admin-route";
import {
  CommunicationsImportValidationError,
  commitSalebotImport,
} from "@/services/CommunicationsImportService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CommitBody = {
  csvText?: string;
  zipBase64?: string;
  originalFileName?: string;
  jobId?: string;
};

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(
    COMMUNICATIONS_ADMIN_ROLES,
    request,
  );
  if ("response" in authResult) {
    return authResult.response;
  }

  let body: CommitBody;
  try {
    body = (await request.json()) as CommitBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Пустое или некорректное тело запроса" },
      { status: 400 },
    );
  }

  try {
    const result = await commitSalebotImport({
      csvText: typeof body.csvText === "string" ? body.csvText : undefined,
      zipBase64: typeof body.zipBase64 === "string" ? body.zipBase64 : undefined,
      originalFileName:
        typeof body.originalFileName === "string" ? body.originalFileName : null,
      jobId: typeof body.jobId === "string" ? body.jobId : null,
      createdByUserId: authResult.user.id,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof CommunicationsImportValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return communicationsAdminErrorResponse(error);
  }
}
