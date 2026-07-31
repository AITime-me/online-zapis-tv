"use client";

import {
  canResetScheduleZoom,
  formatScheduleZoomPercent,
  SCHEDULE_ZOOM_MAX,
  SCHEDULE_ZOOM_MIN,
} from "@/lib/schedule/schedule-zoom";

export function ScheduleZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const atMin = zoom <= SCHEDULE_ZOOM_MIN + 1e-9;
  const atMax = zoom >= SCHEDULE_ZOOM_MAX - 1e-9;
  const showReset = canResetScheduleZoom(zoom);

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      data-testid="schedule-zoom-controls"
      role="group"
      aria-label="Масштаб расписания"
    >
      <button
        type="button"
        data-testid="schedule-zoom-out"
        className="inline-flex h-9 min-w-9 items-center justify-center border border-[#dadce0] bg-white px-2 text-sm text-zinc-800 hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Уменьшить масштаб"
        disabled={atMin}
        onClick={onZoomOut}
      >
        −
      </button>
      <span
        className="min-w-[3.25rem] text-center text-xs tabular-nums text-zinc-700"
        data-testid="schedule-zoom-value"
        aria-live="polite"
      >
        {formatScheduleZoomPercent(zoom)}
      </span>
      <button
        type="button"
        data-testid="schedule-zoom-in"
        className="inline-flex h-9 min-w-9 items-center justify-center border border-[#dadce0] bg-white px-2 text-sm text-zinc-800 hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Увеличить масштаб"
        disabled={atMax}
        onClick={onZoomIn}
      >
        +
      </button>
      {showReset ? (
        <button
          type="button"
          data-testid="schedule-zoom-reset"
          className="ml-0.5 inline-flex h-9 items-center justify-center border border-[#dadce0] bg-white px-2 text-[11px] text-zinc-700 hover:bg-[#f1f3f4]"
          aria-label="Сбросить масштаб на 100 процентов"
          onClick={onReset}
        >
          100%
        </button>
      ) : null}
    </div>
  );
}
