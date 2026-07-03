import {
  AppointmentSource,
  AppointmentStatus,
  ScheduleBlockType,
} from "@prisma/client";

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Запланирована",
  CONFIRMED: "Подтверждена",
  CANCELLED: "Отменена",
  COMPLETED: "Завершена",
  NO_SHOW: "Не пришёл",
};

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  INTERNAL: "Внутренняя",
  ONLINE: "Онлайн",
  BOT: "Бот",
  PHONE: "Телефон",
  OTHER: "Другое",
};

export const BLOCK_TYPE_LABELS: Record<ScheduleBlockType, string> = {
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

export const FULL_DAY_BLOCK_LABELS: Record<
  "DAY_OFF" | "VACATION" | "SICK_LEAVE" | "TRAINING" | "DO_NOT_BOOK",
  string
> = {
  DAY_OFF: "ВЫХОДНОЙ",
  VACATION: "ОТПУСК",
  SICK_LEAVE: "БОЛЬНИЧНЫЙ",
  TRAINING: "ОБУЧЕНИЕ",
  DO_NOT_BOOK: "НЕ СТАВИТЬ",
};

export const INTERVAL_BLOCK_TYPES: ScheduleBlockType[] = [
  "BREAK",
  "LUNCH",
  "TRAINING",
  "PERSONAL",
  "DO_NOT_BOOK",
  "TECHNICAL",
];

export const FULL_DAY_BLOCK_TYPES: Array<
  "DAY_OFF" | "VACATION" | "SICK_LEAVE" | "TRAINING" | "DO_NOT_BOOK"
> = ["DAY_OFF", "VACATION", "SICK_LEAVE", "TRAINING", "DO_NOT_BOOK"];

export function isFullDayBlockType(
  blockType: ScheduleBlockType,
): blockType is keyof typeof FULL_DAY_BLOCK_LABELS {
  return FULL_DAY_BLOCK_TYPES.includes(
    blockType as (typeof FULL_DAY_BLOCK_TYPES)[number],
  );
}

export function getBlockDisplayLabel(
  blockType: ScheduleBlockType,
  isFullDay: boolean,
): string {
  if (isFullDay && isFullDayBlockType(blockType)) {
    return FULL_DAY_BLOCK_LABELS[blockType];
  }
  return BLOCK_TYPE_LABELS[blockType];
}
