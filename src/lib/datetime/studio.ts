import { STUDIO_TIMEZONE as ENV_STUDIO_TIMEZONE } from "@/lib/env";
import {
  addDaysToDateKey,
  formatDateKeyInStudio,
  isValidDateKey,
} from "@/lib/datetime/date-key";

const STUDIO_OFFSET = "+05:00";

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
    dayStart: new Date(`${dateKey}T00:00:00${STUDIO_OFFSET}`),
    dayEnd: new Date(`${dateKey}T23:59:59.999${STUDIO_OFFSET}`),
    dateKey,
    noteDate: new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`),
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

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;
  const dateKey = `${year}-${month}-${day}`;

  return getStudioDayRangeFromDateKey(dateKey, timezone);
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
  value: Date = new Date(),
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
