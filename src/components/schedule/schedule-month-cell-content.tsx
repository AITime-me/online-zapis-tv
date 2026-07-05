import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import { formatStudioTimeRange } from "@/lib/datetime/date-layer";

export function formatMonthCellLine(item: ScheduleMonthCellItem): {
  text: string;
  isBold: boolean;
  isBlock: boolean;
  isFullDayBlock: boolean;
  isExtraWork: boolean;
  hasImportantNote: boolean;
} {
  if (item.kind === "appointment") {
    const time = formatStudioTimeRange(item.startsAt, item.endsAt);
    const servicePart = item.serviceName ? ` · ${item.serviceName}` : "";
    return {
      text: `${time} ${item.clientName}${servicePart}`,
      isBold: item.isBold,
      isBlock: false,
      isFullDayBlock: false,
      isExtraWork: false,
      hasImportantNote: Boolean(item.importantNote),
    };
  }

  if (item.kind === "block") {
    if (item.isFullDay || !item.startsAt || !item.endsAt) {
      return {
        text: item.blockTypeLabel,
        isBold: true,
        isBlock: true,
        isFullDayBlock: true,
        isExtraWork: false,
        hasImportantNote: false,
      };
    }

    const time = formatStudioTimeRange(item.startsAt, item.endsAt);
    const reason = item.blockTypeLabel || item.internalReason || "Блок";
    return {
      text: `БЛОК ${time} ${reason}`,
      isBold: false,
      isBlock: true,
      isFullDayBlock: false,
      isExtraWork: false,
      hasImportantNote: false,
    };
  }

  const time =
    item.startsAt && item.endsAt
      ? formatStudioTimeRange(item.startsAt, item.endsAt)
      : "—";
  return {
    text: `+ ${time}`,
    isBold: false,
    isBlock: false,
    isFullDayBlock: false,
    isExtraWork: true,
    hasImportantNote: false,
  };
}

export function cellHasFullDayBlock(items: ScheduleMonthCellItem[]): boolean {
  return items.some((item) => item.kind === "block" && item.isFullDay);
}
