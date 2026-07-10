import type { AppointmentStatus } from "@prisma/client";

/** Записи в этих статусах не занимают слот в расписании и онлайн-записи. */
export const NON_BLOCKING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "CANCELLED",
  "RESCHEDULED",
];

export function isBlockingAppointmentStatus(status: AppointmentStatus): boolean {
  return !NON_BLOCKING_APPOINTMENT_STATUSES.includes(status);
}
