import type { UserRole } from "@prisma/client";
import {
  canAccessInternalZone,
  canManageOperationalEntities,
} from "@/lib/auth/permissions";

export type ScheduleBookingRequestVisibility = "none" | "sanitized" | "full";

export type ScheduleAppointmentVisibility = "operational" | "master" | "viewOnly";

export type ScheduleLoadOptions = {
  /** Колонка менеджера: заметки и заявки. В view-only режиме — false. */
  includeManagerColumn?: boolean;
  /**
   * Внутренние заметки менеджера / владельца в колонках расписания.
   * false для MASTER и view-only — заметки не попадают в DTO.
   */
  includeOperationalNotes?: boolean;
  /**
   * Уровень данных заявок в колонке менеджера.
   * sanitized — только безопасные поля для MASTER.
   */
  bookingRequestVisibility?: ScheduleBookingRequestVisibility;
  /** Уровень полей записей (appointments) в schedule API. */
  appointmentVisibility?: ScheduleAppointmentVisibility;
  /**
   * @deprecated Используйте bookingRequestVisibility.
   * true → full, false → none.
   */
  includeBookingRequests?: boolean;
  /** Скрыть internalReason у блоков (view-only). */
  stripBlockInternalReason?: boolean;
};

export const SCHEDULE_LOAD_INTERNAL: ScheduleLoadOptions = {
  includeManagerColumn: true,
  includeOperationalNotes: true,
  bookingRequestVisibility: "full",
  appointmentVisibility: "operational",
};

export const SCHEDULE_LOAD_VIEW_ONLY: ScheduleLoadOptions = {
  includeManagerColumn: false,
  includeOperationalNotes: false,
  bookingRequestVisibility: "none",
  appointmentVisibility: "viewOnly",
  stripBlockInternalReason: true,
};

export function resolveBookingRequestVisibility(
  options: ScheduleLoadOptions,
): ScheduleBookingRequestVisibility {
  if (options.bookingRequestVisibility) {
    return options.bookingRequestVisibility;
  }
  if (options.includeBookingRequests === false) {
    return "none";
  }
  return "full";
}

export function resolveAppointmentVisibility(
  options: ScheduleLoadOptions,
): ScheduleAppointmentVisibility {
  return options.appointmentVisibility ?? "operational";
}

export function resolveIncludeOperationalNotes(
  options: ScheduleLoadOptions,
): boolean {
  if (options.includeOperationalNotes !== undefined) {
    return options.includeOperationalNotes;
  }
  return options.includeManagerColumn ?? true;
}

export function scheduleLoadOptionsForRole(role: UserRole): ScheduleLoadOptions {
  if (!canAccessInternalZone(role)) {
    return {
      includeManagerColumn: false,
      includeOperationalNotes: false,
      bookingRequestVisibility: "none",
      appointmentVisibility: "viewOnly",
      stripBlockInternalReason: true,
    };
  }

  const operational = canManageOperationalEntities(role);

  return {
    includeManagerColumn: true,
    includeOperationalNotes: operational,
    bookingRequestVisibility: operational ? "full" : "sanitized",
    appointmentVisibility: operational ? "operational" : "master",
  };
}
