import { NextResponse } from "next/server";
import {
  EXPORT_ALLOWED_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { emergencyExportService } from "@/services/EmergencyExportService";

export async function GET() {
  const authResult = await requireApiRoles(EXPORT_ALLOWED_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const latest = await emergencyExportService.getLatestStatus();
  const latestSuccessful = await emergencyExportService.getLatestSuccessful();

  if (!latest) {
    return NextResponse.json({ ok: true, latest: null, latestSuccessful: null });
  }

  return NextResponse.json({
    ok: true,
    latest: {
      id: latest.id,
      status: latest.status,
      exportType: latest.exportType,
      createdAt: latest.createdAt,
      completedAt: latest.completedAt,
      fileName: latest.filePath
        ? latest.filePath.split(/[/\\]/).pop()
        : null,
      errorMessage: latest.errorMessage,
      downloadUrl:
        latest.status === "SUCCESS"
          ? `/api/emergency-export/${latest.id}/download`
          : null,
    },
    latestSuccessful: latestSuccessful
      ? {
          id: latestSuccessful.id,
          status: latestSuccessful.status,
          createdAt: latestSuccessful.createdAt,
          fileName: latestSuccessful.filePath
            ? latestSuccessful.filePath.split(/[/\\]/).pop()
            : null,
          downloadUrl: `/api/emergency-export/${latestSuccessful.id}/download`,
        }
      : null,
  });
}
