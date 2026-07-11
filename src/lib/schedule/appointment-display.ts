import { formatStudioTime } from "@/lib/datetime/date-layer";
import type { ScheduleAppointmentOperationalFields } from "@/lib/schedule/appointment-contract";
import type { ScheduleDayAppointment } from "@/types/schedule";

/** Заголовок записи в расписании — публичное название услуги. */
export function getScheduleAppointmentTitle(
  serviceName: string | null | undefined,
): string {
  const trimmed = serviceName?.trim();
  return trimmed || "Услуга";
}

export function formatScheduleClientPhone(phone: string | null | undefined): string {
  const trimmed = phone?.trim();
  if (!trimmed) {
    return "—";
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 10) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }

  return trimmed;
}

export function formatScheduleClientName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || "Клиент";
}

export type ScheduleAppointmentDisplay = {
  timeLabel: string;
  serviceTitle: string;
  clientLabel: string;
  phoneLabel: string;
  comment: string | null;
};

/** Подтверждённая клиентом запись выделяется жирным в расписании. */
export function isScheduleAppointmentBold(
  appointment: Pick<ScheduleDayAppointment, "isBold" | "statusCode">,
): boolean {
  return appointment.isBold || appointment.statusCode === "CONFIRMED";
}

export function buildScheduleAppointmentDisplay(
  appointment: Pick<
    ScheduleDayAppointment,
    "startsAt" | "endsAt" | "serviceName" | "clientName"
  > &
    Partial<Pick<ScheduleAppointmentOperationalFields, "clientPhone" | "comment">>,
): ScheduleAppointmentDisplay {
  return {
    timeLabel: formatStudioTime(appointment.startsAt),
    serviceTitle: getScheduleAppointmentTitle(appointment.serviceName),
    clientLabel: formatScheduleClientName(appointment.clientName),
    phoneLabel: formatScheduleClientPhone(appointment.clientPhone),
    comment: appointment.comment?.trim() || null,
  };
}

export function formatSchedulePromoBadgeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "Акция";
  }
  if (/^акция\s*:/i.test(trimmed)) {
    return trimmed;
  }
  return `Акция: ${trimmed}`;
}
