import { getWeekdayIndex } from "@/lib/datetime/date-key";

export const DEFAULT_WEEKDAY_WORK_START = "09:00";
export const DEFAULT_WEEKDAY_WORK_END = "20:00";
export const DEFAULT_WEEKEND_WORK_START = "10:00";
export const DEFAULT_WEEKEND_WORK_END = "20:00";
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_BREAK_AFTER_MINUTES = 15;

export type MasterWorkHoursSource = {
  workStart: string;
  workEnd: string;
  usesDefaultWorkHours: boolean;
};

export function resolveMasterWorkHours(
  master: MasterWorkHoursSource,
  dateKey: string,
): { workStart: string; workEnd: string } {
  if (!master.usesDefaultWorkHours) {
    return {
      workStart: master.workStart,
      workEnd: master.workEnd,
    };
  }

  const weekdayIndex = getWeekdayIndex(dateKey);
  const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;

  if (isWeekend) {
    return {
      workStart: DEFAULT_WEEKEND_WORK_START,
      workEnd: DEFAULT_WEEKEND_WORK_END,
    };
  }

  return {
    workStart: DEFAULT_WEEKDAY_WORK_START,
    workEnd: DEFAULT_WEEKDAY_WORK_END,
  };
}
