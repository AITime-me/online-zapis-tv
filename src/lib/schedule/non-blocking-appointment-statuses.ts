import type { AppointmentStatus } from "@prisma/client";

/**
 * Статусы, которые не занимают слот (публичная запись / конфликт расписания).
 * Не смешивать со скрытием из сетки: см. HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES.
 */
export const NON_BLOCKING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "CANCELLED",
  "RESCHEDULED",
];

/**
 * Статусы, скрытые из активной сетки расписания (day/month/cell/view-only).
 * Остаются в БД и в истории клиента. RESCHEDULED сюда не входит —
 * он должен оставаться видимой информационной карточкой.
 */
export const HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES: AppointmentStatus[] = [
  "CANCELLED",
];

export function isBlockingAppointmentStatus(status: AppointmentStatus): boolean {
  return !NON_BLOCKING_APPOINTMENT_STATUSES.includes(status);
}

export function isHiddenFromActiveSchedule(
  status: AppointmentStatus,
): boolean {
  return HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES.includes(status);
}

/** Условие Prisma: только записи, видимые в активной сетке. */
export function activeScheduleAppointmentWhere(): {
  status: { notIn: AppointmentStatus[] };
} {
  return {
    status: { notIn: [...HIDDEN_FROM_ACTIVE_SCHEDULE_STATUSES] },
  };
}
