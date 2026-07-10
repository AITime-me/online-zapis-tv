import type { UserRole } from "@prisma/client";
import {
  canAccessInternalZone,
  canManageOperationalEntities,
} from "@/lib/auth/permissions";

export type ScheduleBookingRequestVisibility = "none" | "sanitized" | "full";

export type ScheduleLoadOptions = {
  /** Колонка менеджера: заметки и заявки. В view-only режиме — false. */
  includeManagerColumn?: boolean;
  /**
   * Уровень данных заявок в колонке менеджера.
   * sanitized — только безопасные поля для MASTER.
   */
  bookingRequestVisibility?: ScheduleBookingRequestVisibility;
  /**
   * @deprecated Используйте bookingRequestVisibility.
   * true → full, false → none.
   */
  includeBookingRequests?: boolean;
};

export const SCHEDULE_LOAD_INTERNAL: ScheduleLoadOptions = {
  includeManagerColumn: true,
  bookingRequestVisibility: "full",
};

export const SCHEDULE_LOAD_VIEW_ONLY: ScheduleLoadOptions = {
  includeManagerColumn: false,
  bookingRequestVisibility: "none",
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

export function scheduleLoadOptionsForRole(role: UserRole): ScheduleLoadOptions {
  if (!canAccessInternalZone(role)) {
    return {
      includeManagerColumn: false,
      bookingRequestVisibility: "none",
    };
  }

  return {
    includeManagerColumn: true,
    bookingRequestVisibility: canManageOperationalEntities(role)
      ? "full"
      : "sanitized",
  };
}
