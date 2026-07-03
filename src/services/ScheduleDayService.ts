import {
  AppointmentSource,
  AppointmentStatus,
  ScheduleBlockType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudioDayRangeFromDateKey } from "@/lib/datetime/studio";
import type { ScheduleDayData } from "@/types/schedule";

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

export async function getScheduleDayData(
  dateKey: string,
): Promise<ScheduleDayData> {
  const { dayStart, dayEnd, noteDate } = getStudioDayRangeFromDateKey(dateKey);

  const [masters, managerNotes] = await Promise.all([
    prisma.master.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        appointments: {
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
          },
          include: { service: true },
          orderBy: { startsAt: "asc" },
        },
        scheduleBlocks: {
          where: {
            startsAt: { gte: dayStart, lte: dayEnd },
          },
          orderBy: { startsAt: "asc" },
        },
      },
    }),
    prisma.managerNote.findMany({
      where: { noteDate },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    date: dateKey,
    managerNotes: managerNotes.map((note) => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
    })),
    masters: masters.map((master) => ({
      id: master.id,
      internalName: master.internalName,
      publicName: master.publicName,
      appointments: master.appointments.map((appointment) => ({
        id: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        serviceName: appointment.service?.publicName ?? null,
        comment: appointment.comment,
        importantNote: appointment.importantNote,
        isBold: appointment.isBold,
        status: APPOINTMENT_STATUS_LABELS[appointment.status],
        source: APPOINTMENT_SOURCE_LABELS[appointment.source],
      })),
      scheduleBlocks: master.scheduleBlocks.map((block) => ({
        id: block.id,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
        blockType: block.blockType,
        blockTypeLabel: BLOCK_TYPE_LABELS[block.blockType],
        internalReason: block.internalReason,
      })),
    })),
  };
}
