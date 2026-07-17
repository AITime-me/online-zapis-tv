import { getWeekdayIndex } from "@/lib/datetime/date-layer";

export const DEFAULT_WEEKDAY_WORK_START = "09:00";
export const DEFAULT_WEEKEND_WORK_START = "10:00";

/**
 * Последний допустимый старт записи при стандартных часах студии (включительно).
 * Процедура может заканчиваться позже этого времени.
 */
export const DEFAULT_LAST_BOOKING_START = "18:00";

/**
 * @deprecated Используйте DEFAULT_LAST_BOOKING_START.
 * Оставлено как алиас для placeholder workEnd при создании мастера с дефолтами.
 */
export const DEFAULT_WEEKDAY_WORK_END = DEFAULT_LAST_BOOKING_START;

/**
 * @deprecated Используйте DEFAULT_LAST_BOOKING_START.
 */
export const DEFAULT_WEEKEND_WORK_END = DEFAULT_LAST_BOOKING_START;

export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_BREAK_AFTER_MINUTES = 15;

export type MasterWorkHoursSource = {
  workStart: string;
  workEnd: string;
  usesDefaultWorkHours: boolean;
};

export type ResolvedMasterWorkHours = {
  workStart: string;
  /**
   * При стандартных часах — последний допустимый старт (включительно).
   * При индивидуальном графике — конец рабочего интервала (услуга должна уложиться).
   */
  workEnd: string;
  /**
   * true — индивидуальный график: конец услуги должен быть ≤ workEnd.
   * false — официальные часы студии: ограничивается только старт (≤ workEnd).
   */
  constrainAppointmentEnd: boolean;
};

export function compareWorkTimeStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function resolveMasterWorkHours(
  master: MasterWorkHoursSource,
  dateKey: string,
): ResolvedMasterWorkHours {
  if (!master.usesDefaultWorkHours) {
    return {
      workStart: master.workStart,
      workEnd: master.workEnd,
      constrainAppointmentEnd: true,
    };
  }

  const weekdayIndex = getWeekdayIndex(dateKey);
  const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;

  return {
    workStart: isWeekend
      ? DEFAULT_WEEKEND_WORK_START
      : DEFAULT_WEEKDAY_WORK_START,
    workEnd: DEFAULT_LAST_BOOKING_START,
    constrainAppointmentEnd: false,
  };
}

/**
 * Часы для публичной онлайн-записи.
 * Индивидуальный график может сужать окно, но не расширять старты позже
 * DEFAULT_LAST_BOOKING_START (18:00 включительно).
 */
export function resolvePublicOnlineBookingHours(
  master: MasterWorkHoursSource,
  dateKey: string,
): ResolvedMasterWorkHours {
  const base = resolveMasterWorkHours(master, dateKey);

  if (compareWorkTimeStrings(base.workEnd, DEFAULT_LAST_BOOKING_START) <= 0) {
    return base;
  }

  return {
    workStart: base.workStart,
    workEnd: DEFAULT_LAST_BOOKING_START,
    constrainAppointmentEnd: false,
  };
}

/** Старт в пределах разрешённого окна (без учёта длительности услуги). */
export function isAllowedBookingStart(
  startTime: string,
  hours: Pick<
    ResolvedMasterWorkHours,
    "workStart" | "workEnd" | "constrainAppointmentEnd"
  >,
): boolean {
  if (compareWorkTimeStrings(startTime, hours.workStart) < 0) {
    return false;
  }

  if (hours.constrainAppointmentEnd) {
    return compareWorkTimeStrings(startTime, hours.workEnd) < 0;
  }

  return compareWorkTimeStrings(startTime, hours.workEnd) <= 0;
}

/**
 * Укладывается ли интервал услуги в resolved hours.
 * endTime — окончание процедуры без перерыва после неё.
 */
export function doesAppointmentFitResolvedHours(
  startTime: string,
  endTime: string,
  hours: Pick<
    ResolvedMasterWorkHours,
    "workStart" | "workEnd" | "constrainAppointmentEnd"
  >,
): boolean {
  if (!isAllowedBookingStart(startTime, hours)) {
    return false;
  }

  if (!hours.constrainAppointmentEnd) {
    return true;
  }

  return compareWorkTimeStrings(endTime, hours.workEnd) <= 0;
}
