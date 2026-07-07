import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import { formatStudioTimeRange } from "@/lib/datetime/date-layer";
import {
  buildScheduleAppointmentDisplay,
  getScheduleAppointmentTitle,
} from "@/lib/schedule/appointment-display";
import { formatMonthAppointmentClientLine } from "@/components/schedule/appointment-detail-summary";

export function formatMonthCellLine(item: ScheduleMonthCellItem): {
  title: string;
  subtitle: string | null;
  isBold: boolean;
  isBlock: boolean;
  isFullDayBlock: boolean;
  isExtraWork: boolean;
  hasImportantNote: boolean;
  hasPromotions: boolean;
} {
  if (item.kind === "appointment") {
    const display = buildScheduleAppointmentDisplay(item);
    return {
      title: `${display.timeLabel} · ${getScheduleAppointmentTitle(item.serviceName)}`,
      subtitle: formatMonthAppointmentClientLine(item),
      isBold: item.isBold,
      isBlock: false,
      isFullDayBlock: false,
      isExtraWork: false,
      hasImportantNote: Boolean(item.importantNote),
      hasPromotions: item.appliedPromotions.length > 0,
    };
  }

  if (item.kind === "block") {
    if (item.isFullDay || !item.startsAt || !item.endsAt) {
      return {
        title: item.blockTypeLabel,
        subtitle: null,
        isBold: true,
        isBlock: true,
        isFullDayBlock: true,
        isExtraWork: false,
        hasImportantNote: false,
        hasPromotions: false,
      };
    }

    const time = formatStudioTimeRange(item.startsAt, item.endsAt);
    const reason = item.blockTypeLabel || item.internalReason || "Блок";
    return {
      title: `БЛОК ${reason}`,
      subtitle: time,
      isBold: false,
      isBlock: true,
      isFullDayBlock: false,
      isExtraWork: false,
      hasImportantNote: false,
      hasPromotions: false,
    };
  }

  const time =
    item.startsAt && item.endsAt
      ? formatStudioTimeRange(item.startsAt, item.endsAt)
      : "—";
  return {
    title: "+ Доп. окно",
    subtitle: time,
    isBold: false,
    isBlock: false,
    isFullDayBlock: false,
    isExtraWork: true,
    hasImportantNote: false,
    hasPromotions: false,
  };
}

export function cellHasFullDayBlock(items: ScheduleMonthCellItem[]): boolean {
  return items.some((item) => item.kind === "block" && item.isFullDay);
}
