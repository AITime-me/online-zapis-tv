/**
 * Публичная политика: утренние слоты онлайн-записи закрываются
 * в 21:00 предыдущего календарного дня (время студии).
 *
 * Только self-booking flow. OWNER/MANAGER / AppointmentService не используют.
 */

import {
  addDaysSafe,
  formatStudioDateKey,
  parseStudioDateKey,
} from "@/lib/datetime/date-layer";
import { parseTimeToMinutes } from "@/lib/booking/online-slot-chains";

/** Слоты, начинающиеся строго раньше этой границы, считаются утренними. */
export const PUBLIC_MORNING_SLOT_BOUNDARY_TIME = "12:00";

/** Момент закрытия публичной записи на утренний слот — предыдущий день. */
export const PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME = "21:00";

export const PUBLIC_MORNING_SLOT_CUTOFF_CODE = "PUBLIC_MORNING_SLOT_CUTOFF" as const;

export const PUBLIC_MORNING_SLOT_CUTOFF_MESSAGE =
  "Запись на утреннее время закрывается в 21:00 предыдущего дня. Пожалуйста, выберите другое время.";

export class PublicMorningSlotCutoffError extends Error {
  constructor(message = PUBLIC_MORNING_SLOT_CUTOFF_MESSAGE) {
    super(message);
    this.name = PUBLIC_MORNING_SLOT_CUTOFF_CODE;
  }
}

export type PublicMorningSlotCutoffDecision = {
  blocked: boolean;
  isMorningSlot: boolean;
  cutoffAt: Date | null;
};

function tryParseTimeToMinutes(time: string): number | null {
  try {
    return parseTimeToMinutes(time.trim());
  } catch {
    return null;
  }
}

/** Утренний слот: startTime строго раньше 12:00 (12:00 этим правилом не блокируется). */
export function isPublicMorningSlotStart(startTime: string): boolean {
  const startMinutes = tryParseTimeToMinutes(startTime);
  const boundaryMinutes = tryParseTimeToMinutes(PUBLIC_MORNING_SLOT_BOUNDARY_TIME);
  if (startMinutes === null || boundaryMinutes === null) {
    return false;
  }
  return startMinutes < boundaryMinutes;
}

/**
 * Instant закрытия публичной записи на утренние слоты дня `slotDateKey`:
 * 21:00 предыдущего календарного дня в Asia/Yekaterinburg.
 *
 * Не использует addDaysToDateKey (у того есть today-fallback на невалидных ключах).
 */
export function getPublicMorningSlotCutoffAt(slotDateKey: string): Date | null {
  const parsed = parseStudioDateKey(slotDateKey, "12:00");
  if (!parsed) {
    return null;
  }

  const previousDate = addDaysSafe(parsed, -1);
  if (!previousDate) {
    return null;
  }

  const previousDayKey = formatStudioDateKey(previousDate);
  return parseStudioDateKey(
    previousDayKey,
    PUBLIC_MORNING_PREVIOUS_DAY_CUTOFF_TIME,
  );
}

/**
 * Заблокирован ли публичный слот правилом morning cutoff.
 * `now` — единый момент запроса (не локальная TZ ОС).
 */
export function evaluatePublicMorningSlotCutoff(input: {
  slotDateKey: string;
  startTime: string;
  now: Date;
}): PublicMorningSlotCutoffDecision {
  const isMorningSlot = isPublicMorningSlotStart(input.startTime);
  if (!isMorningSlot) {
    return { blocked: false, isMorningSlot: false, cutoffAt: null };
  }

  const cutoffAt = getPublicMorningSlotCutoffAt(input.slotDateKey);
  // Fail-closed: утренний слот без вычислимого cutoffAt нельзя разрешать публично.
  if (!cutoffAt) {
    return { blocked: true, isMorningSlot: true, cutoffAt: null };
  }

  return {
    blocked: input.now.getTime() >= cutoffAt.getTime(),
    isMorningSlot: true,
    cutoffAt,
  };
}

export function isPublicMorningSlotBlocked(input: {
  slotDateKey: string;
  startTime: string;
  now: Date;
}): boolean {
  return evaluatePublicMorningSlotCutoff(input).blocked;
}

export function filterSlotsByPublicMorningCutoff(
  slots: string[],
  slotDateKey: string,
  now: Date,
): string[] {
  return slots.filter(
    (startTime) =>
      !isPublicMorningSlotBlocked({ slotDateKey, startTime, now }),
  );
}

/** Явная серверная проверка перед созданием клиента / Appointment. */
export function assertPublicMorningSlotAllowed(input: {
  slotDateKey: string;
  startTime: string;
  now: Date;
}): void {
  if (isPublicMorningSlotBlocked(input)) {
    throw new PublicMorningSlotCutoffError();
  }
}
