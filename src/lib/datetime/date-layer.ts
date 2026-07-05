/** Единый client-safe слой работы с датами (Asia/Yekaterinburg). */

export const STUDIO_TIMEZONE = "Asia/Yekaterinburg";
const STUDIO_OFFSET = "+05:00";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;

export function isValidMonthKey(monthKey: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return false;
  }

  const month = Number(monthKey.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

export function safeTimestamp(date: Date | null | undefined): number | null {
  if (!(date instanceof Date)) {
    return null;
  }

  const time = date.getTime();
  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  return time;
}

export function normalizeDate(input: unknown): Date | null {
  if (input == null || input === "") {
    return null;
  }

  if (input instanceof Date) {
    return safeTimestamp(input) !== null ? input : null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    return normalizeDate(new Date(trimmed));
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return null;
    }
    return normalizeDate(new Date(input));
  }

  return null;
}

/** Текущий момент; гарантированно валидный Date. */
export function getStudioNow(): Date {
  return normalizeDate(new Date()) ?? new Date(Date.now());
}

export function toIsoString(input?: unknown): string {
  return (normalizeDate(input) ?? getStudioNow()).toISOString();
}

export function formatStudioDateKey(date: Date): string {
  const normalized = normalizeDate(date) ?? getStudioNow();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(normalized);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;

  return `${year}-${month}-${day}`;
}

/** Alias для обратной совместимости. */
export const formatDateKeyInStudio = formatStudioDateKey;

export function formatMonthKey(date: Date): string {
  return formatStudioDateKey(date).slice(0, 7);
}

/** Alias для обратной совместимости. */
export const formatBookingMonthKey = formatMonthKey;

export function normalizeMonthKey(input?: string | null): string {
  const trimmed = input?.trim();
  if (trimmed && isValidMonthKey(trimmed)) {
    return trimmed;
  }

  return formatMonthKey(getStudioNow());
}

/** Alias для обратной совместимости. */
export const normalizeBookingMonthKey = normalizeMonthKey;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** month — 1..12 */
export function getDaysInMonthCount(year: number, month: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 0;
  }

  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return lengths[month - 1]!;
}

export function getDaysInMonthKey(monthKey: string): string[] {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const year = Number(normalizedMonthKey.slice(0, 4));
  const month = Number(normalizedMonthKey.slice(5, 7));
  const daysInMonth = getDaysInMonthCount(year, month);

  if (daysInMonth <= 0) {
    return getDaysInMonthKey(formatMonthKey(getStudioNow()));
  }

  const days: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }

  return days;
}

export function addMonthsToMonthKey(monthKey: string, delta: number): string {
  const normalizedMonthKey = normalizeMonthKey(monthKey);

  if (!Number.isFinite(delta)) {
    return normalizedMonthKey;
  }

  const year = Number(normalizedMonthKey.slice(0, 4));
  const month = Number(normalizedMonthKey.slice(5, 7));
  const totalMonths = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;

  if (newMonth < 1 || newMonth > 12 || !Number.isFinite(newYear)) {
    return formatMonthKey(getStudioNow());
  }

  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

export function addDaysSafe(date: Date, days: number): Date | null {
  const baseTimestamp = safeTimestamp(date);
  if (baseTimestamp === null || !Number.isFinite(days)) {
    return null;
  }

  return normalizeDate(new Date(baseTimestamp + days * MS_PER_DAY));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  if (!isValidDateKey(dateKey) || !Number.isFinite(days)) {
    return formatStudioDateKey(getStudioNow());
  }

  const base = parseStudioDateKey(dateKey);
  if (!base) {
    return formatStudioDateKey(getStudioNow());
  }

  const shifted = addDaysSafe(base, days);
  if (!shifted) {
    return formatStudioDateKey(getStudioNow());
  }

  return formatStudioDateKey(shifted);
}

export function parseStudioDateKey(dateKey: string, time = "12:00"): Date | null {
  if (!isValidDateKey(dateKey)) {
    return null;
  }

  return normalizeDate(new Date(`${dateKey}T${time}:00${STUDIO_OFFSET}`));
}

export function parseStudioDateKeyEndOfDay(dateKey: string): Date | null {
  if (!isValidDateKey(dateKey)) {
    return null;
  }

  return normalizeDate(new Date(`${dateKey}T23:59:59.999${STUDIO_OFFSET}`));
}

export function parseStudioDateTime(dateKey: string, time: string): Date {
  return parseStudioDateKey(dateKey, time) ?? getStudioNow();
}

export function addMinutesSafe(date: Date, minutes: number): Date | null {
  const baseTimestamp = safeTimestamp(date);
  if (baseTimestamp === null || !Number.isFinite(minutes)) {
    return null;
  }

  return normalizeDate(new Date(baseTimestamp + minutes * MS_PER_MINUTE));
}

export function addMinutesToDateTime(
  date: Date,
  minutes: number,
  fallback?: Date,
): Date {
  return addMinutesSafe(date, minutes) ?? fallback ?? getStudioNow();
}

export function formatStudioTime(value: Date | string): string {
  const date = normalizeDate(value);
  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatStudioTimeInput(value: Date | string): string {
  return formatStudioTime(value);
}

export function formatStudioDate(value: Date | string): string {
  const date = normalizeDate(value);
  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateKeyLabel(dateKey: string): string {
  const date = parseStudioDateKey(dateKey);
  if (!date) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatStudioTimeRange(
  startsAt: Date | string,
  endsAt: Date | string,
): string {
  const start = formatStudioTime(startsAt);
  const end = formatStudioTime(endsAt);

  if (start === "—" && end === "—") {
    return "—";
  }

  return `${start}–${end}`;
}

export function diffMinutes(start: Date, end: Date): number {
  const startTime = safeTimestamp(start);
  const endTime = safeTimestamp(end);

  if (startTime === null || endTime === null) {
    return 0;
  }

  return Math.round((endTime - startTime) / MS_PER_MINUTE);
}

function formatWeekdayShort(dateKey: string): string {
  const date = parseStudioDateKey(dateKey);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "short",
  })
    .format(date)
    .replace(/\.$/, "")
    .replace(/^вс/i, "Вс")
    .replace(/^пн/i, "Пн")
    .replace(/^вт/i, "Вт")
    .replace(/^ср/i, "Ср")
    .replace(/^чт/i, "Чт")
    .replace(/^пт/i, "Пт")
    .replace(/^сб/i, "Сб");
}

export function formatMonthRowDateParts(dateKey: string): {
  weekday: string;
  dateLabel: string;
} {
  const date = parseStudioDateKey(dateKey);
  const dateLabel = date
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: STUDIO_TIMEZONE,
        day: "2-digit",
        month: "2-digit",
      }).format(date)
    : "—";

  return {
    weekday: formatWeekdayShort(dateKey),
    dateLabel,
  };
}

export function formatMonthRowDateLabel(dateKey: string): string {
  const { weekday, dateLabel } = formatMonthRowDateParts(dateKey);
  return `${weekday} ${dateLabel}`;
}

export function getWeekdayIndex(dateKey: string): number {
  const date = parseStudioDateKey(dateKey);
  if (!date) {
    return 0;
  }

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "short",
  }).format(date);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday] ?? 0;
}

export function formatMonthTitle(monthKey: string): string {
  const normalizedMonthKey = normalizeMonthKey(monthKey);
  const date = parseStudioDateKey(`${normalizedMonthKey}-01`);

  if (!date) {
    return formatMonthTitle(formatMonthKey(getStudioNow()));
  }

  const label = new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Минимальная дата для сортировки / fallback в интервалах. */
export function getEpochDate(): Date {
  return parseStudioDateKey("1970-01-01", "00:00") ?? getStudioNow();
}
