import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  EXPORT_ALLOWED_ROLES,
  requireApiRoles,
} from "@/lib/auth/api-access";
import { emergencyExportService } from "@/services/EmergencyExportService";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireApiRoles(EXPORT_ALLOWED_ROLES);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { id } = await context.params;
  const exportRecord = await emergencyExportService.getById(id);

  if (!exportRecord || exportRecord.status !== "SUCCESS" || !exportRecord.filePath) {
    return NextResponse.json(
      { ok: false, error: "Export file not found" },
      { status: 404 },
    );
  }

  try {
    const fileBuffer = await readFile(exportRecord.filePath);
    const fileName = emergencyExportService.resolveDownloadFileName(exportRecord);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to read export file" },
      { status: 500 },
    );
  }
}
