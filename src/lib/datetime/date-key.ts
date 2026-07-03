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
