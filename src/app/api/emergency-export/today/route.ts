import { NextResponse } from "next/server";
import {
  EXPORT_ALLOWED_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { emergencyExportService } from "@/services/EmergencyExportService";

export async function POST() {
  const authResult = await requireApiRoles(EXPORT_ALLOWED_ROLES);
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
