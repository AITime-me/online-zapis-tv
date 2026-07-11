import { NextResponse } from "next/server";
import { EXPORT_ALLOWED_ROLES, requireApiRoles, requireProtectedMutatingApi, requireProtectedInternalMutatingApi } from "@/lib/auth/api-access";
import { emergencyExportService } from "@/services/EmergencyExportService";

export async function POST(request: Request) {
  const authResult = await requireProtectedMutatingApi(EXPORT_ALLOWED_ROLES, request);
  if ("response" in authResult) {
    return authResult.response;
  }

  const result = await emergencyExportService.exportToday(authResult.user.id);

  if (result.export.status !== "SUCCESS" || !result.fileName) {
    return NextResponse.json(
      {
        ok: false,
        exportId: result.export.id,
        error: result.export.errorMessage ?? "Export failed",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    exportId: result.export.id,
    fileName: result.fileName,
    downloadUrl: `/api/emergency-export/${result.export.id}/download`,
  });
}
