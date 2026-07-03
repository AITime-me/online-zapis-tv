/** Client-safe datetime helpers. No env, Prisma, or server-only imports. */

export const STUDIO_TIMEZONE = "Asia/Yekaterinburg";
const STUDIO_OFFSET = "+05:00";

export function isValidDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`);
  const shifted = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return formatDateKeyInStudio(shifted);
}

export function formatDateKeyInStudio(value: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;

  return `${year}-${month}-${day}`;
}

export function formatDateKeyLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`));
}

export function formatStudioTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatStudioDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;

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
  return `${formatStudioTime(startsAt)}–${formatStudioTime(endsAt)}`;
}

export function parseStudioDateTime(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00+05:00`);
}

export function formatStudioTimeInput(value: Date | string): string {
  return formatStudioTime(value);
}

export function diffMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function isValidMonthKey(monthKey: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return false;
  }

  const month = Number(monthKey.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function getDaysInMonthKey(monthKey: string): string[] {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }

  return days;
}

export function addMonthsToMonthKey(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const date = new Date(`${year}-${String(month).padStart(2, "0")}-01T12:00:00${STUDIO_OFFSET}`);
  date.setMonth(date.getMonth() + delta);
  return formatDateKeyInStudio(date).slice(0, 7);
}


function formatWeekdayShort(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`);
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
  const date = new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(date);

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
  const date = new Date(`${dateKey}T12:00:00${STUDIO_OFFSET}`);
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
  const date = new Date(`${monthKey}-01T12:00:00${STUDIO_OFFSET}`);
  const label = new Intl.DateTimeFormat("ru-RU", {
    timeZone: STUDIO_TIMEZONE,
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}
