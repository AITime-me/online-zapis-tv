/**
 * Часовой пояс студии Asia/Yekaterinburg для планирования рассылок.
 */

import { STUDIO_TIMEZONE } from "@/lib/communications/composer-labels";

export class CommScheduleValidationError extends Error {}

/** Разбор локальной даты/времени студии в UTC Date. */
export function parseStudioLocalDateTime(input: {
  date: string;
  time: string;
  timeZone?: string;
}): Date {
  const date = input.date.trim();
  const time = input.time.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new CommScheduleValidationError("Некорректная дата");
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new CommScheduleValidationError("Некорректное время");
  }

  const timeZone = input.timeZone ?? STUDIO_TIMEZONE;
  // Интерпретация как локальное время зоны через Intl offset probe.
  const isoLocal = `${date}T${time}:00`;
  const asUtcGuess = new Date(`${isoLocal}Z`);
  if (Number.isNaN(asUtcGuess.getTime())) {
    throw new CommScheduleValidationError("Не удалось разобрать дату и время");
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Ищем UTC-момент, который в зоне даёт нужные компоненты.
  let candidate = asUtcGuess;
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    const asInZone = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const desired = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
      0,
    );
    const delta = desired - asInZone;
    if (delta === 0) {
      break;
    }
    candidate = new Date(candidate.getTime() + delta);
  }

  return candidate;
}

export function assertNotInPast(
  scheduledAt: Date,
  now: Date = new Date(),
): void {
  if (scheduledAt.getTime() < now.getTime() - 60_000) {
    throw new CommScheduleValidationError(
      "Нельзя запланировать рассылку на прошедшее время",
    );
  }
}

export function attributionDaysToHours(days: number): number {
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    throw new CommScheduleValidationError(
      "Период учёта результатов — от 1 до 30 дней",
    );
  }
  return Math.round(days) * 24;
}

export function attributionHoursToDays(hours: number): number {
  return Math.max(1, Math.round(hours / 24));
}
