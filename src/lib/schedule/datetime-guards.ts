import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import {
  normalizeDate,
  safeTimestamp,
} from "@/lib/datetime/date-layer";

export function getScheduleSortTimestamp(
  value: string | null | undefined,
  options?: { fullDay?: boolean },
): number {
  if (options?.fullDay || !value) {
    return 0;
  }

  const time = safeTimestamp(normalizeDate(value));
  if (time === null) {
    return Number.MAX_SAFE_INTEGER;
  }

  return time;
}

export function compareScheduleTimestamps(
  left: string | null | undefined,
  right: string | null | undefined,
  leftOptions?: { fullDay?: boolean },
  rightOptions?: { fullDay?: boolean },
): number {
  return (
    getScheduleSortTimestamp(left, leftOptions) -
    getScheduleSortTimestamp(right, rightOptions)
  );
}

export function compareScheduleMonthCellItems(
  left: ScheduleMonthCellItem,
  right: ScheduleMonthCellItem,
): number {
  const leftFullDay = left.kind === "block" && left.isFullDay;
  const rightFullDay = right.kind === "block" && right.isFullDay;

  return compareScheduleTimestamps(
    left.startsAt,
    right.startsAt,
    { fullDay: leftFullDay },
    { fullDay: rightFullDay },
  );
}
