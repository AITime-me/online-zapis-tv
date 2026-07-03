"use client";

import type { ScheduleMonthCellItem } from "@/types/schedule-month";
import {
  cellHasFullDayBlock,
  formatMonthCellLine,
} from "@/components/schedule/schedule-month-cell-content";

export function ScheduleMonthCell({
  items,
  onOpen,
}: {
  items: ScheduleMonthCellItem[];
  onOpen: () => void;
}) {
  const isFullDayClosed = cellHasFullDayBlock(items);
  const isEmpty = items.length === 0;

  return (
    <td
      className={`cursor-pointer border-r border-[#d0d5da] px-1.5 py-0.5 align-top hover:bg-[#e3ecf9] ${
        isFullDayClosed ? "bg-[#eceff1]" : ""
      }`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title={isEmpty ? "Открыть быстрый редактор" : undefined}
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
                  {line.text}
                </div>
                {line.hasImportantNote && item.kind === "appointment" ? (
                  <div className="text-[9px] leading-tight text-amber-800">
                    ⚠ {item.importantNote}
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
