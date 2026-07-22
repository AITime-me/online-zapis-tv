/**
 * Машинные коды конфликтов записи при write (manual/public).
 * Pure helpers — без server-only зависимостей (пригодно для security-скриптов).
 */

export const APPOINTMENT_BUSY_CONFLICT_MESSAGE =
  "У мастера уже есть запись или перерыв в это время.";

export type AppointmentConflictType = "appointment" | "block" | "full_day_block";

export type AppointmentConflictCode =
  | "APPOINTMENT_OVERLAP"
  | "SCHEDULE_BLOCK"
  | "FULL_DAY_BLOCK";

export type AppointmentWriteConflict = {
  message: string;
  code: AppointmentConflictCode;
  conflictType: AppointmentConflictType;
};

/**
 * Решает, какой блокирующий конфликт остаётся после учёта allowAppointmentOverlap.
 * Override снимает только type === "appointment"; block / full_day_block всегда запрещают.
 */
export function resolveAppointmentWriteConflict(
  conflicts: ReadonlyArray<{ type: string }>,
  allowAppointmentOverlap: boolean,
): AppointmentWriteConflict | null {
  if (conflicts.some((conflict) => conflict.type === "full_day_block")) {
    return {
      message: "День мастера закрыт",
      code: "FULL_DAY_BLOCK",
      conflictType: "full_day_block",
    };
  }

  if (conflicts.some((conflict) => conflict.type === "block")) {
    return {
      message: "Это время закрыто блоком",
      code: "SCHEDULE_BLOCK",
      conflictType: "block",
    };
  }

  if (
    conflicts.some((conflict) => conflict.type === "appointment") &&
    allowAppointmentOverlap !== true
  ) {
    return {
      message: APPOINTMENT_BUSY_CONFLICT_MESSAGE,
      code: "APPOINTMENT_OVERLAP",
      conflictType: "appointment",
    };
  }

  return null;
}
