"use client";

import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import {
  isMasterScheduleAppointment,
  isOperationalScheduleAppointment,
} from "@/lib/schedule/appointment-contract";
import {
  cellHasFullDayBlock,
  formatMonthCellLine,
} from "@/components/schedule/schedule-month-cell-content";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
import {
  AppointmentMasterNoteBlock,
  AppointmentPromotionLabelBadges,
} from "@/components/schedule/appointment-master-display";
import { MASTER_COL } from "@/components/schedule/schedule-month-table-styles";

export function ScheduleMonthCell({
  items,
  onOpen,
  cellTestId,
}: {
  items: ScheduleMonthCellItem[];
  onOpen?: () => void;
  cellTestId?: string;
}) {
  const isFullDayClosed = cellHasFullDayBlock(items);
  const isEmpty = items.length === 0;
  const isInteractive = Boolean(onOpen);

  return (
    <td
      data-testid={cellTestId}
      className={`${MASTER_COL} border-b border-r border-[#d0d5da] px-1.5 py-0.5 align-top ${
        isInteractive ? "cursor-pointer hover:bg-[#e3ecf9]" : ""
      } ${isFullDayClosed ? "bg-[#eceff1]" : ""}`}
      onClick={onOpen}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      title={isInteractive && isEmpty ? "Открыть быстрый редактор" : undefined}
    >
      {isEmpty ? (
        <span className="text-[10px] text-zinc-400">—</span>
      ) : (
        <div className="flex flex-col gap-px">
          {items.map((item) => {
            const line = formatMonthCellLine(item);
            return (
              <div key={item.id} className="leading-tight">
                <div
                  className={`text-[10px] ${
                    line.isFullDayBlock
                      ? "font-bold uppercase tracking-wide text-zinc-600"
                      : "text-zinc-800"
                  } ${line.isBold && !line.isFullDayBlock ? "font-bold" : ""} ${
                    line.isBlock && !line.isFullDayBlock ? "text-zinc-600" : ""
                  } ${line.isExtraWork ? "text-[#1a73e8]" : ""}`}
                >
                  {line.title}
                </div>
                {line.subtitle ? (
                  <div className="text-[9px] tabular-nums text-zinc-500">
                    {line.subtitle}
                  </div>
                ) : null}
                {line.rescheduleNotice ? (
                  <div className="mt-px rounded bg-amber-50 px-1 py-0.5 text-[9px] font-semibold leading-snug text-amber-900">
                    {line.rescheduleNotice}
                  </div>
                ) : null}
                {item.kind === "appointment" &&
                line.hasPromotionLabels &&
                isOperationalScheduleAppointment(item) ? (
                  <AppointmentPromoBadges promotions={item.appliedPromotions} />
                ) : null}
                {item.kind === "appointment" &&
                line.hasPromotionLabels &&
                isMasterScheduleAppointment(item) ? (
                  <AppointmentPromotionLabelBadges labels={item.promotionLabels} />
                ) : null}
                {line.hasMasterNote && line.masterNote ? (
                  <div className="mt-px">
                    <AppointmentMasterNoteBlock note={line.masterNote} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </td>
  );
}
