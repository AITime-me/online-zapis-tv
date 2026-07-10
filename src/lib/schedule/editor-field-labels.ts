import type {
  AppointmentSource,
  AppointmentStatus,
  ScheduleBlockType,
} from "@prisma/client";

/** Подписи полей форм editor UI расписания. */
export const SCHEDULE_EDITOR_FIELD_LABELS = {
  startTime: "Начало",
  endTime: "Окончание",
  service: "Услуга",
  clientName: "Клиент",
  clientPhone: "Телефон",
  status: "Статус",
  source: "Источник",
  comment: "Комментарий",
  importantNote: "Важная пометка",
  isBold: "Жирное выделение",
  blockType: "Тип блока",
  closureType: "Тип закрытия",
  onlineBooking: "Доступно онлайн",
} as const;

export type ScheduleEditorFieldKey = keyof typeof SCHEDULE_EDITOR_FIELD_LABELS;

/** Подписи значений select «Статус» в editor UI. */
export const EDITOR_APPOINTMENT_STATUS_LABELS: Record<
  AppointmentStatus,
  string
> = {
  SCHEDULED: "Запланирована",
  CONFIRMED: "Подтверждена",
  CANCELLED: "Отменена",
  RESCHEDULED: "Перенесена",
  COMPLETED: "Завершена",
  NO_SHOW: "Не пришёл",
};

/** Подписи значений select «Источник» в editor UI. */
export const EDITOR_APPOINTMENT_SOURCE_LABELS: Record<
  AppointmentSource,
  string
> = {
  INTERNAL: "Внутренняя",
  ONLINE: "Онлайн",
  BOT: "Бот",
  PHONE: "Телефон",
  OTHER: "Другое",
};

/** Подписи типов интервальных блоков в editor UI. */
export const EDITOR_BLOCK_TYPE_LABELS: Record<ScheduleBlockType, string> = {
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

/** Подписи типов закрытия дня в editor UI. */
export const EDITOR_FULL_DAY_CLOSURE_LABELS: Record<
  "DAY_OFF" | "VACATION" | "SICK_LEAVE" | "TRAINING" | "DO_NOT_BOOK",
  string
> = {
  DAY_OFF: "ВЫХОДНОЙ",
  VACATION: "ОТПУСК",
  SICK_LEAVE: "БОЛЬНИЧНЫЙ",
  TRAINING: "ОБУЧЕНИЕ",
  DO_NOT_BOOK: "НЕ СТАВИТЬ",
};

export const EDITOR_UNKNOWN_OPTION_LABEL = "—";

export function getScheduleEditorFieldLabel(
  field: ScheduleEditorFieldKey,
): string {
  return SCHEDULE_EDITOR_FIELD_LABELS[field];
}

export function getEditorAppointmentStatusLabel(value: string): string {
  return (
    EDITOR_APPOINTMENT_STATUS_LABELS[value as AppointmentStatus] ??
    EDITOR_UNKNOWN_OPTION_LABEL
  );
}

export function getEditorAppointmentSourceLabel(value: string): string {
  return (
    EDITOR_APPOINTMENT_SOURCE_LABELS[value as AppointmentSource] ??
    EDITOR_UNKNOWN_OPTION_LABEL
  );
}

export function getEditorBlockTypeLabel(value: string): string {
  return (
    EDITOR_BLOCK_TYPE_LABELS[value as ScheduleBlockType] ??
    EDITOR_UNKNOWN_OPTION_LABEL
  );
}

export function getEditorFullDayClosureLabel(value: string): string {
  return (
    EDITOR_FULL_DAY_CLOSURE_LABELS[
      value as keyof typeof EDITOR_FULL_DAY_CLOSURE_LABELS
    ] ?? EDITOR_UNKNOWN_OPTION_LABEL
  );
}
