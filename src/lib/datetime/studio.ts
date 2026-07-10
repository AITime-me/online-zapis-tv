import { STUDIO_TIMEZONE as ENV_STUDIO_TIMEZONE } from "@/lib/env";
import {
  addDaysToDateKey,
  formatDateKeyInStudio,
  formatStudioDateKey,
  getDaysInMonthKey,
  getStudioNow,
  isValidDateKey,
  normalizeMonthKey,
  parseStudioDateKey,
  parseStudioDateKeyEndOfDay,
} from "@/lib/datetime/date-layer";

export type StudioDayRange = {
  dayStart: Date;
  dayEnd: Date;
  dateKey: string;
  noteDate: Date;
};

export function getStudioDayRangeFromDateKey(
  dateKey: string,
  timezone: string = ENV_STUDIO_TIMEZONE,
): StudioDayRange {
  if (!isValidDateKey(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return {
    dayStart: parseStudioDateKey(dateKey, "00:00") ?? getStudioNow(),
    dayEnd: parseStudioDateKeyEndOfDay(dateKey) ?? getStudioNow(),
    dateKey,
    noteDate: parseStudioDateKey(dateKey, "12:00") ?? getStudioNow(),
  };
}

export function getStudioTodayRange(
  timezone: string = ENV_STUDIO_TIMEZONE,
): StudioDayRange {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(getStudioNow());
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;
  const dateKey = `${year}-${month}-${day}`;

  return getStudioDayRangeFromDateKey(dateKey, timezone);
}

export type StudioThreeDayRange = {
  periodFrom: Date;
  periodTo: Date;
  dateKeyFrom: string;
  dateKeyTo: string;
  dateKeys: [string, string, string];
  noteDates: [Date, Date, Date];
};

/** Сегодня, завтра и послезавтра в часовом поясе студии. */
export function getStudioThreeDayRange(
  timezone: string = ENV_STUDIO_TIMEZONE,
): StudioThreeDayRange {
  const today = getStudioTodayRange(timezone);
  const tomorrowKey = addDaysToDateKey(today.dateKey, 1);
  const dayAfterKey = addDaysToDateKey(today.dateKey, 2);
  const tomorrow = getStudioDayRangeFromDateKey(tomorrowKey, timezone);
  const dayAfter = getStudioDayRangeFromDateKey(dayAfterKey, timezone);

  return {
    periodFrom: today.dayStart,
    periodTo: dayAfter.dayEnd,
    dateKeyFrom: today.dateKey,
    dateKeyTo: dayAfterKey,
    dateKeys: [today.dateKey, tomorrowKey, dayAfterKey],
    noteDates: [today.noteDate, tomorrow.noteDate, dayAfter.noteDate],
  };
}

export function formatStudioDate(
  value: Date,
  timezone: string = ENV_STUDIO_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function formatStudioTime(
  value: Date,
  timezone: string = ENV_STUDIO_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function formatExportFileTimestamp(
  value: Date = getStudioNow(),
  timezone: string = ENV_STUDIO_TIMEZONE,
): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${pick("year")}-${pick("month")}-${pick("day")}_${pick("hour")}-${pick("minute")}`;
}

export { addDaysToDateKey, formatDateKeyInStudio, isValidDateKey };

export function getStudioCurrentMonthKey(
  timezone: string = ENV_STUDIO_TIMEZONE,
): string {
  return getStudioTodayRange(timezone).dateKey.slice(0, 7);
}

export function getStudioMonthRangeFromMonthKey(
  monthKey: string,
  timezone: string = ENV_STUDIO_TIMEZONE,
) {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const days = getDaysInMonthKey(normalizedMonthKey);
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;

  return {
    monthKey: normalizedMonthKey,
    days,
    monthStart: getStudioDayRangeFromDateKey(firstDay, timezone).dayStart,
    monthEnd: getStudioDayRangeFromDateKey(lastDay, timezone).dayEnd,
  };
}

export { formatStudioDateKey };
