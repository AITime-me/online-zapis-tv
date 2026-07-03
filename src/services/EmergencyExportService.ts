import { mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  AppointmentSource,
  AppointmentStatus,
  EmergencyExportStatus,
  EmergencyExportType,
  ExportStorage,
  ScheduleBlockType,
  type EmergencyExport,
  type Prisma,
} from "@prisma/client";
import { env, STUDIO_TIMEZONE } from "@/lib/env";
import { prisma } from "@/lib/db";
import {
  formatExportFileTimestamp,
  formatStudioDate,
  formatStudioTime,
  getStudioTodayRange,
} from "@/lib/datetime/studio";

export type ExportParams = {
  exportType: EmergencyExportType;
  periodFrom: Date;
  periodTo: Date;
  requestedByUserId?: string;
};

export type ExportResult = {
  export: EmergencyExport;
  filePath: string | null;
  fileName: string | null;
};

type ExportRow = {
  sortAt: Date;
  values: string[];
};

const HEADERS = [
  "Дата",
  "Мастер / колонка",
  "Время начала",
  "Время окончания",
  "Тип",
  "Клиент",
  "Телефон",
  "Услуга",
  "Комментарий",
  "Важная пометка",
  "Статус",
  "Источник",
  "Тип блока",
];

const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Запланирована",
  CONFIRMED: "Подтверждена",
  CANCELLED: "Отменена",
  COMPLETED: "Завершена",
  NO_SHOW: "Не пришёл",
};

const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  INTERNAL: "Внутренняя",
  ONLINE: "Онлайн",
  BOT: "Бот",
  PHONE: "Телефон",
  OTHER: "Другое",
};

const BLOCK_TYPE_LABELS: Record<ScheduleBlockType, string> = {
  DAY_OFF: "Выходной",
  VACATION: "Отпуск",
  TRAINING: "Обучение",
  DO_NOT_BOOK: "Не ставить",
  BREAK: "Перерыв",
  PERSONAL: "Личное время",
  TECHNICAL: "Техническое окно",
};

export class EmergencyExportService {
  async exportToday(requestedByUserId?: string): Promise<ExportResult> {
    const { dayStart, dayEnd, dateKey, noteDate } = getStudioTodayRange();

    return this.export({
      exportType: EmergencyExportType.TODAY,
      periodFrom: dayStart,
      periodTo: dayEnd,
      requestedByUserId,
      dateKey,
      noteDate,
    });
  }

  private async export(params: {
    exportType: EmergencyExportType;
    periodFrom: Date;
    periodTo: Date;
    requestedByUserId?: string;
    dateKey: string;
    noteDate: Date;
  }): Promise<ExportResult> {
    const storage: ExportStorage =
      env.EXPORT_STORAGE === "s3" ? ExportStorage.S3 : ExportStorage.LOCAL;

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

    try {
      if (storage === ExportStorage.S3) {
        throw new Error("S3 storage is not configured yet");
      }

      await mkdir(env.EXPORT_LOCAL_DIR, { recursive: true });

      const fileName = `emergency_today_${formatExportFileTimestamp()}.xlsx`;
      const filePath = path.join(env.EXPORT_LOCAL_DIR, fileName);

      const rows = await this.collectRows(
        params.periodFrom,
        params.periodTo,
        params.noteDate,
      );

      await this.writeWorkbook(filePath, rows);

      const updated = await prisma.emergencyExport.update({
        where: { id: exportRecord.id },
        data: {
          status: EmergencyExportStatus.SUCCESS,
          filePath,
          completedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: params.requestedByUserId,
          action: "emergency_export.success",
          entityType: "emergency_export",
          entityId: exportRecord.id,
          payload: {
            exportType: params.exportType,
            fileName,
            filePath,
            dateKey: params.dateKey,
          },
        },
      });

      return { export: updated, filePath, fileName };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown export error";

      const failed = await prisma.emergencyExport.update({
        where: { id: exportRecord.id },
        data: {
          status: EmergencyExportStatus.FAILED,
          errorMessage: message,
          completedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: params.requestedByUserId,
          action: "emergency_export.failed",
          entityType: "emergency_export",
          entityId: exportRecord.id,
          payload: { error: message },
        },
      });

      return { export: failed, filePath: null, fileName: null };
    }
  }

  private async collectRows(
    dayStart: Date,
    dayEnd: Date,
    noteDate: Date,
  ): Promise<ExportRow[]> {
    const appointmentWhere: Prisma.AppointmentWhereInput = {
      startsAt: { gte: dayStart, lte: dayEnd },
    };

    const blockWhere: Prisma.ScheduleBlockWhereInput = {
      startsAt: { gte: dayStart, lte: dayEnd },
    };

    const [appointments, blocks, managerNotes] = await Promise.all([
      prisma.appointment.findMany({
        where: appointmentWhere,
        include: {
          master: true,
          service: true,
        },
        orderBy: { startsAt: "asc" },
      }),
      prisma.scheduleBlock.findMany({
        where: blockWhere,
        include: { master: true },
        orderBy: { startsAt: "asc" },
      }),
      prisma.managerNote.findMany({
        where: { noteDate },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const rows: ExportRow[] = [];

    for (const appointment of appointments) {
      rows.push({
        sortAt: appointment.startsAt,
        values: [
          formatStudioDate(appointment.startsAt),
          appointment.master.internalName,
          formatStudioTime(appointment.startsAt),
          formatStudioTime(appointment.endsAt),
          "Запись",
          appointment.clientName,
          appointment.clientPhone,
          appointment.service?.publicName ?? "",
          appointment.comment ?? "",
          appointment.importantNote ?? "",
          APPOINTMENT_STATUS_LABELS[appointment.status],
          APPOINTMENT_SOURCE_LABELS[appointment.source],
          "",
        ],
      });
    }

    for (const block of blocks) {
      rows.push({
        sortAt: block.startsAt,
        values: [
          formatStudioDate(block.startsAt),
          block.master?.internalName ?? "Менеджер",
          formatStudioTime(block.startsAt),
          formatStudioTime(block.endsAt),
          "Блок",
          "",
          "",
          "",
          block.internalReason ?? "",
          "",
          "",
          "",
          BLOCK_TYPE_LABELS[block.blockType],
        ],
      });
    }

    for (const note of managerNotes) {
      rows.push({
        sortAt: new Date(note.noteDate.getTime() + 23 * 60 * 60 * 1000),
        values: [
          formatStudioDate(note.noteDate),
          "Менеджер",
          "",
          "",
          "Заметка менеджера",
          "",
          "",
          "",
          note.content,
          "",
          "",
          "",
          "",
        ],
      });
    }

    rows.sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime());

    if (rows.length === 0) {
      rows.push({
        sortAt: dayStart,
        values: [
          formatStudioDate(dayStart),
          "",
          "",
          "",
          "Нет записей на выбранную дату",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ],
      });
    }

    return rows;
  }

  private async writeWorkbook(
    filePath: string,
    rows: ExportRow[],
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Сегодня");

    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(row.values);
    }

    sheet.columns.forEach((column) => {
      column.width = 18;
    });

    await workbook.xlsx.writeFile(filePath);
  }

  async getLatestStatus(): Promise<EmergencyExport | null> {
    return prisma.emergencyExport.findFirst({
      orderBy: { createdAt: "desc" },
    });
  }

  async getLatestSuccessful(): Promise<EmergencyExport | null> {
    return prisma.emergencyExport.findFirst({
      where: { status: EmergencyExportStatus.SUCCESS },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string): Promise<EmergencyExport | null> {
    return prisma.emergencyExport.findUnique({ where: { id } });
  }

  resolveDownloadFileName(exportRecord: EmergencyExport): string {
    if (!exportRecord.filePath) {
      return "emergency_export.xlsx";
    }
    return path.basename(exportRecord.filePath);
  }
}

export const emergencyExportService = new EmergencyExportService();

export type { EmergencyExport };

export { STUDIO_TIMEZONE };
