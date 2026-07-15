import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import { formatStudioTimeRange } from "@/lib/datetime/date-layer";
import {
  isMasterScheduleAppointment,
  isOperationalScheduleAppointment,
} from "@/lib/schedule/appointment-contract";
import {
  buildScheduleAppointmentDisplay,
  getScheduleAppointmentTitle,
  isScheduleAppointmentBold,
} from "@/lib/schedule/appointment-display";
import { formatMonthAppointmentClientLine } from "@/components/schedule/appointment-detail-summary";
import { CLIENT_RESCHEDULE_APPOINTMENT_NOTICE } from "@/lib/schedule/client-reschedule-notice";

export function formatMonthCellLine(item: ScheduleMonthCellItem): {
  title: string;
  subtitle: string | null;
  isBold: boolean;
  isBlock: boolean;
  isFullDayBlock: boolean;
  isExtraWork: boolean;
  hasMasterNote: boolean;
  hasPromotionLabels: boolean;
  promotionLabels: string[];
  masterNote: string | null;
  rescheduleNotice: string | null;
} {
  if (item.kind === "appointment") {
    const display = buildScheduleAppointmentDisplay(item);
    const operational = isOperationalScheduleAppointment(item);
    const master = isMasterScheduleAppointment(item);

    return {
      title: `${display.timeLabel} · ${getScheduleAppointmentTitle(item.serviceName)}`,
      subtitle: formatMonthAppointmentClientLine(item),
      isBold: isScheduleAppointmentBold(item),
      isBlock: false,
      isFullDayBlock: false,
      isExtraWork: false,
      hasMasterNote: operational
        ? Boolean(item.importantNote)
        : master
          ? Boolean(item.masterNote)
          : false,
      hasPromotionLabels: operational
        ? item.appliedPromotions.length > 0
        : master
          ? item.promotionLabels.length > 0
          : false,
      promotionLabels: master ? item.promotionLabels : [],
      masterNote: operational
        ? item.importantNote
        : master
          ? item.masterNote
          : null,
      rescheduleNotice:
        item.statusCode === "RESCHEDULED" ? CLIENT_RESCHEDULE_APPOINTMENT_NOTICE : null,
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
        hasMasterNote: false,
        hasPromotionLabels: false,
        promotionLabels: [],
        masterNote: null,
        rescheduleNotice: null,
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
      hasMasterNote: false,
      hasPromotionLabels: false,
      promotionLabels: [],
      masterNote: null,
      rescheduleNotice: null,
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
    hasMasterNote: false,
    hasPromotionLabels: false,
    promotionLabels: [],
    masterNote: null,
    rescheduleNotice: null,
  };
}

export function cellHasFullDayBlock(items: ScheduleMonthCellItem[]): boolean {
  return items.some((item) => item.kind === "block" && item.isFullDay);
}
