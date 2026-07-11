import type { AppliedPromotionRecord } from "@/types/applied-promotion";

/** Поля записи, безопасные для MASTER и view-only расписания. */
export type ScheduleAppointmentSharedFields = {
  id: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  clientName: string;
  serviceName: string | null;
  isBold: boolean;
  isManualTimeOverride: boolean;
  status: string;
  source: string;
  statusCode: string;
  sourceCode: string;
};

/** View-only — только базовые поля без операционных пометок. */
export type ScheduleAppointmentViewOnlyFields = ScheduleAppointmentSharedFields;

/** MASTER — shared + безопасные подписи акций и ручная пометка. */
export type ScheduleAppointmentMasterFields = ScheduleAppointmentSharedFields & {
  promotionLabels: string[];
  masterNote: string | null;
};

/** OWNER / MANAGER — рабочие поля без manageToken. */
export type ScheduleAppointmentOperationalFields = ScheduleAppointmentSharedFields & {
  clientPhone: string;
  comment: string | null;
  importantNote: string | null;
  appliedPromotions: AppliedPromotionRecord[];
};

export type ScheduleAppointmentVisibility = "operational" | "master" | "viewOnly";

export const FORBIDDEN_MASTER_APPOINTMENT_KEYS = [
  "clientPhone",
  "phone",
  "comment",
  "email",
  "manageToken",
  "clientId",
  "importantNote",
  "appliedPromotions",
] as const;

export const FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS = [
  ...FORBIDDEN_MASTER_APPOINTMENT_KEYS,
  "promotionLabels",
  "masterNote",
] as const;

/** @deprecated Используйте FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS. */
export const FORBIDDEN_RESTRICTED_APPOINTMENT_KEYS =
  FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS;

export function collectForbiddenMasterAppointmentKeys(
  value: Record<string, unknown>,
): string[] {
  return FORBIDDEN_MASTER_APPOINTMENT_KEYS.filter((key) => key in value);
}

export function collectForbiddenViewOnlyAppointmentKeys(
  value: Record<string, unknown>,
): string[] {
  return FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS.filter((key) => key in value);
}

export function collectForbiddenRestrictedAppointmentKeys(
  value: Record<string, unknown>,
): string[] {
  return collectForbiddenViewOnlyAppointmentKeys(value);
}

export function isOperationalScheduleAppointment(
  appointment:
    | ScheduleAppointmentOperationalFields
    | ScheduleAppointmentMasterFields
    | ScheduleAppointmentViewOnlyFields,
): appointment is ScheduleAppointmentOperationalFields {
  return "clientPhone" in appointment;
}

export function isMasterScheduleAppointment(
  appointment:
    | ScheduleAppointmentOperationalFields
    | ScheduleAppointmentMasterFields
    | ScheduleAppointmentViewOnlyFields,
): appointment is ScheduleAppointmentMasterFields {
  return "promotionLabels" in appointment;
}

export function assertMasterAppointmentShape(value: Record<string, unknown>): void {
  const forbidden = collectForbiddenMasterAppointmentKeys(value);
  if (forbidden.length > 0) {
    throw new Error(
      `Master appointment DTO contains forbidden keys: ${forbidden.join(", ")}`,
    );
  }
}

export function assertRestrictedAppointmentShape(
  value: Record<string, unknown>,
): void {
  const forbidden = collectForbiddenViewOnlyAppointmentKeys(value);
  if (forbidden.length > 0) {
    throw new Error(
      `Restricted appointment DTO contains forbidden keys: ${forbidden.join(", ")}`,
    );
  }
}
