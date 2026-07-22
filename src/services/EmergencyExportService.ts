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
import { neutralizeSpreadsheetFormulaValue } from "@/lib/csv/neutralize-spreadsheet-value";
import { prisma } from "@/lib/db";
import {
  addMinutesSafe,
  getStudioNow,
} from "@/lib/datetime/date-layer";
import {
  formatExportFileTimestamp,
  formatStudioDate,
  formatStudioTime,
  getStudioThreeDayRange,
} from "@/lib/datetime/studio";
import {
  getAppointmentBusyInterval,
  toAppointmentBusyTimingSnapshot,
} from "@/lib/schedule/appointment-busy";

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
  RESCHEDULED: "Перенесена",
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
  SICK_LEAVE: "Больничный",
  TRAINING: "Обучение",
  DO_NOT_BOOK: "Не ставить",
  BREAK: "Перерыв",
  LUNCH: "Обед",
  PERSONAL: "Личное время",
  TECHNICAL: "Техническое окно",
};

export class EmergencyExportService {
  async exportToday(requestedByUserId?: string): Promise<ExportResult> {
    const range = getStudioThreeDayRange();

    return this.export({
      exportType: EmergencyExportType.TODAY,
      periodFrom: range.periodFrom,
      periodTo: range.periodTo,
      requestedByUserId,
      dateKeyFrom: range.dateKeyFrom,
      dateKeyTo: range.dateKeyTo,
      noteDates: range.noteDates,
    });
  }

  private async export(params: {
    exportType: EmergencyExportType;
    periodFrom: Date;
    periodTo: Date;
    requestedByUserId?: string;
    dateKeyFrom: string;
    dateKeyTo: string;
    noteDates: Date[];
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

      const fileName = `emergency_${params.dateKeyFrom}_to_${params.dateKeyTo}_${formatExportFileTimestamp()}.xlsx`;
      const filePath = path.join(env.EXPORT_LOCAL_DIR, fileName);

      const rows = await this.collectRows(
        params.periodFrom,
        params.periodTo,
        params.noteDates,
      );

      await this.writeWorkbook(filePath, rows);

      const updated = await prisma.emergencyExport.update({
        where: { id: exportRecord.id },
        data: {
          status: EmergencyExportStatus.SUCCESS,
          filePath,
          completedAt: getStudioNow(),
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
            dateKeyFrom: params.dateKeyFrom,
            dateKeyTo: params.dateKeyTo,
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
          completedAt: getStudioNow(),
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
    periodStart: Date,
    periodEnd: Date,
    noteDates: Date[],
  ): Promise<ExportRow[]> {
    const appointmentWhere: Prisma.AppointmentWhereInput = {
      startsAt: { gte: periodStart, lte: periodEnd },
    };

    const blockWhere: Prisma.ScheduleBlockWhereInput = {
      OR: [
        { startsAt: { gte: periodStart, lte: periodEnd } },
        { isFullDay: true, blockDate: { in: noteDates } },
      ],
    };

    const [appointments, blocks, managerNotes, extraWorkWindows] =
      await Promise.all([
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
        where: { noteDate: { in: noteDates } },
        orderBy: [{ noteDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.extraWorkWindow.findMany({
        where: { workDate: { in: noteDates } },
        include: { master: true },
        orderBy: [{ workDate: "asc" }, { startsAt: "asc" }],
      }),
    ]);

    const rows: ExportRow[] = [];

    for (const appointment of appointments) {
      const busyEnd = getAppointmentBusyInterval(
        toAppointmentBusyTimingSnapshot(appointment),
      ).endsAt;
      rows.push({
        sortAt: appointment.startsAt,
        values: [
          formatStudioDate(appointment.startsAt),
          appointment.master.internalName,
          formatStudioTime(appointment.startsAt),
          formatStudioTime(busyEnd),
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
        sortAt: block.isFullDay
          ? addMinutesSafe(block.blockDate ?? periodStart, 12 * 60) ??
            (block.blockDate ?? periodStart)
          : block.startsAt!,
        values: [
          formatStudioDate(block.isFullDay ? block.blockDate! : block.startsAt!),
          block.master?.internalName ?? "Менеджер",
          block.isFullDay ? "Весь день" : formatStudioTime(block.startsAt!),
          block.isFullDay ? "Весь день" : formatStudioTime(block.endsAt!),
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

    for (const extra of extraWorkWindows) {
      rows.push({
        sortAt: extra.startsAt,
        values: [
          formatStudioDate(extra.workDate),
          extra.master.internalName,
          formatStudioTime(extra.startsAt),
          formatStudioTime(extra.endsAt),
          "Доп. окно",
          "",
          "",
          "",
          extra.isOnlineBookingEnabled ? "Онлайн-запись включена" : "",
          "",
          "",
          "",
          "",
        ],
      });
    }

    for (const note of managerNotes) {
      rows.push({
        sortAt: addMinutesSafe(note.noteDate, 23 * 60) ?? note.noteDate,
        values: [
          formatStudioDate(note.noteDate),
          "Менеджер",
          "",
          "",
          note.noteType === "OWNER"
            ? "Заметка руководителя"
            : "Заметка менеджера",
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
        sortAt: periodStart,
        values: [
          formatStudioDate(periodStart),
          "",
          "",
          "",
          "Нет данных за выбранный период",
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
    const sheet = workbook.addWorksheet("Расписание");

    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      const excelRow = sheet.addRow(
        row.values.map((value) => neutralizeSpreadsheetFormulaValue(value)),
      );
      excelRow.eachCell((cell) => {
        cell.numFmt = "@";
      });
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
