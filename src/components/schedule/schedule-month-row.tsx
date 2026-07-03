"use client";

import type { ScheduleMonthData, QuickDayEditorData, QuickManagerEditorData, QuickOwnerEditorData } from "@/types/schedule-month";
import type { ScheduleMonthMaster } from "@/types/schedule-month";
import { ScheduleMonthManagerCell } from "@/components/schedule/schedule-month-manager-cell";
import { ScheduleMonthOwnerCell } from "@/components/schedule/schedule-month-owner-cell";
import { ScheduleMonthCell } from "@/components/schedule/schedule-month-cell";
import {
  formatMonthRowDateParts,
  getWeekdayIndex,
} from "@/lib/datetime/date-key";

function buildEditorData(
  dateKey: string,
  master: ScheduleMonthMaster,
  items: ScheduleMonthData["days"][number]["masterCells"][string],
): QuickDayEditorData {
  const appointments = items
    .filter((item) => item.kind === "appointment")
    .map(({ kind: _kind, ...rest }) => rest);
  const scheduleBlocks = items
    .filter((item) => item.kind === "block")
    .map(({ kind: _kind, ...rest }) => rest);
  const extraWorkWindows = items
    .filter((item) => item.kind === "extraWork")
    .map(({ kind: _kind, ...rest }) => rest);

  return {
    dateKey,
    masterId: master.id,
    masterInternalName: master.internalName,
    masterPublicName: master.publicName,
    appointments,
    scheduleBlocks,
    extraWorkWindows,
  };
}

export function ScheduleMonthRow({
  day,
  rowIndex,
  masters,
  studioToday,
  onCellOpen,
  onManagerCellOpen,
  onOwnerCellOpen,
}: {
  day: ScheduleMonthData["days"][number];
  rowIndex: number;
  masters: ScheduleMonthMaster[];
  studioToday: string;
  onCellOpen: (data: QuickDayEditorData) => void;
  onManagerCellOpen: (data: QuickManagerEditorData) => void;
  onOwnerCellOpen: (data: QuickOwnerEditorData) => void;
}) {
  const isToday = day.dateKey === studioToday;
  const weekdayIndex = getWeekdayIndex(day.dateKey);
  const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
  const isStriped = rowIndex % 2 === 1;

  const rowBg = isToday
    ? "bg-[#edf3fc]"
    : isStriped
      ? "bg-[#f7f8f9]"
      : "bg-white";

  const { weekday: weekdayLabel, dateLabel } = formatMonthRowDateParts(day.dateKey);
  const dateCellBg = isToday ? "bg-[#dceaf8]" : "bg-[#f0f2f5]";

  return (
    <tr className={`border-b border-[#d0d5da] ${rowBg}`}>
      <td
        className={`sticky left-0 z-[1] border-r-2 border-[#b8c0c8] px-2 py-1 align-top ${dateCellBg}`}
      >
        <div className="flex flex-col gap-0.5 leading-none">
          <span
            className={`text-[9px] font-medium uppercase tracking-wide ${
              isToday
                ? "text-[#1a73e8]"
                : isWeekend
                  ? "text-zinc-400"
                  : "text-zinc-500"
            }`}
          >
            {weekdayLabel}
          </span>
          <span
            className={`text-[13px] font-bold tabular-nums ${
              isToday
                ? "text-[15px] text-[#1a73e8]"
                : isWeekend
                  ? "text-zinc-600"
                  : "text-zinc-900"
            }`}
          >
            {dateLabel}
          </span>
        </div>
      </td>

      <ScheduleMonthManagerCell
        notes={day.managerNotes}
        onOpen={() =>
          onManagerCellOpen({
            dateKey: day.dateKey,
            notes: day.managerNotes,
          })
        }
      />

      <ScheduleMonthOwnerCell
        notes={day.ownerNotes}
        onOpen={() =>
          onOwnerCellOpen({
            dateKey: day.dateKey,
            notes: day.ownerNotes,
          })
        }
      />

      {masters.map((master) => (
        <ScheduleMonthCell
          key={master.id}
          items={day.masterCells[master.id] ?? []}
          onOpen={() =>
            onCellOpen(buildEditorData(day.dateKey, master, day.masterCells[master.id] ?? []))
          }
        />
      ))}
    </tr>
  );
}
