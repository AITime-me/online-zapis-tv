"use client";

import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import {
  cellHasFullDayBlock,
  formatMonthCellLine,
} from "@/components/schedule/schedule-month-cell-content";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
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
                {line.hasImportantNote && item.kind === "appointment" ? (
                  <div className="text-[9px] leading-tight text-amber-800">
                    ⚠ {item.importantNote}
                  </div>
                ) : null}
                {item.kind === "appointment" && line.hasPromotions ? (
                  <AppointmentPromoBadges promotions={item.appliedPromotions} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </td>
  );
}
