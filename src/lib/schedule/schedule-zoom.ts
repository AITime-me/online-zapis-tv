/**
 * Локальный масштаб содержимого таблицы расписания (не browser zoom / не viewport meta).
 * Min 100%, max 200%, шаг кнопок 10% — удобный диапазон 100→200 без мелкой дробности.
 */

export const SCHEDULE_ZOOM_MIN = 1;
export const SCHEDULE_ZOOM_MAX = 2;
export const SCHEDULE_ZOOM_STEP = 0.1;
export const SCHEDULE_ZOOM_DEFAULT = 1;

export function clampScheduleZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return SCHEDULE_ZOOM_DEFAULT;
  }
  const clamped = Math.min(SCHEDULE_ZOOM_MAX, Math.max(SCHEDULE_ZOOM_MIN, value));
  return Math.round(clamped * 100) / 100;
}

export function stepScheduleZoom(current: number, direction: 1 | -1): number {
  return clampScheduleZoom(current + direction * SCHEDULE_ZOOM_STEP);
}

export function formatScheduleZoomPercent(zoom: number): string {
  return `${Math.round(clampScheduleZoom(zoom) * 100)}%`;
}

export function canResetScheduleZoom(zoom: number): boolean {
  return clampScheduleZoom(zoom) !== SCHEDULE_ZOOM_DEFAULT;
}

/** Расстояние между двумя точками касания (для pinch). */
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export function zoomFromPinch(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (!(startDistance > 0) || !(currentDistance > 0)) {
    return clampScheduleZoom(startZoom);
  }
  return clampScheduleZoom(startZoom * (currentDistance / startDistance));
}
