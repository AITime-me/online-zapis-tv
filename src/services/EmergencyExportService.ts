import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  EmergencyExportStatus,
  EmergencyExportType,
  ExportStorage,
  type EmergencyExport,
} from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

export type ExportParams = {
  exportType: EmergencyExportType;
  periodFrom: Date;
  periodTo: Date;
  requestedByUserId?: string;
};

export type ExportResult = {
  export: EmergencyExport;
  filePath: string | null;
};

/**
 * Аварийная выгрузка расписания.
 * Каркас сервиса: запись попыток в emergency_exports и audit_logs.
 * Генерация XLSX — отдельный ранний шаг после Bootstrap.
 */
export class EmergencyExportService {
  async export(params: ExportParams): Promise<ExportResult> {
    const storage: ExportStorage = env.EXPORT_STORAGE === "s3" ? "S3" : "LOCAL";

    const exportRecord = await prisma.emergencyExport.create({
      data: {
        exportType: params.exportType,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        storage,
        status: EmergencyExportStatus.PENDING,
        requestedByUserId: params.requestedByUserId,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: params.requestedByUserId,
        action: "emergency_export.requested",
        entityType: "emergency_export",
        entityId: exportRecord.id,
        payload: {
          exportType: params.exportType,
          periodFrom: params.periodFrom.toISOString(),
          periodTo: params.periodTo.toISOString(),
          storage,
        },
      },
    });

    if (storage === ExportStorage.LOCAL) {
      await mkdir(env.EXPORT_LOCAL_DIR, { recursive: true });
    }

    // TODO (ранний шаг): собрать данные, сформировать XLSX через ExcelJS, обновить status/filePath
    return { export: exportRecord, filePath: null };
  }

  async getLatestStatus(): Promise<EmergencyExport | null> {
    return prisma.emergencyExport.findFirst({
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string): Promise<EmergencyExport | null> {
    return prisma.emergencyExport.findUnique({ where: { id } });
  }

  buildLocalFilePath(exportId: string): string {
    return path.join(env.EXPORT_LOCAL_DIR, `emergency-${exportId}.xlsx`);
  }
}

export const emergencyExportService = new EmergencyExportService();

export type { EmergencyExport };
