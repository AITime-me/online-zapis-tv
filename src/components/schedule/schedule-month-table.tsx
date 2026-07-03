"use client";

import type { ScheduleMonthData, QuickDayEditorData, QuickManagerEditorData, QuickOwnerEditorData } from "@/types/schedule-month";
import { ScheduleMonthRow } from "@/components/schedule/schedule-month-row";

const DATE_COL = "sticky left-0 z-[2] w-[84px] min-w-[84px]";
const MANAGER_COL = "w-[160px] min-w-[160px]";
const OWNER_COL = "w-[160px] min-w-[160px]";
const MASTER_COL = "w-[200px] min-w-[200px]";

const BORDER_OUTER = "border-[#c7cdd3]";
const BORDER_INNER = "border-[#d0d5da]";
const BORDER_DATE = "border-[#b8c0c8]";
const HEADER_BG = "bg-[#eef0f3]";
const DATE_HEADER_BG = "bg-[#e8ebf0]";

export function ScheduleMonthTable({
  data,
  onCellOpen,
  onManagerCellOpen,
  onOwnerCellOpen,
}: {
  data: ScheduleMonthData;
  onCellOpen: (editorData: QuickDayEditorData) => void;
  onManagerCellOpen: (editorData: QuickManagerEditorData) => void;
  onOwnerCellOpen: (editorData: QuickOwnerEditorData) => void;
}) {
  return (
    <div
      className={`overflow-auto border ${BORDER_OUTER} bg-white`}
      style={{ maxHeight: "calc(100vh - 120px)" }}
    >
      <table className="w-max min-w-full border-collapse text-left">
        <thead className={`sticky top-0 z-[3] ${HEADER_BG}`}>
          <tr className={`border-b ${BORDER_OUTER}`}>
            <th
              className={`${DATE_COL} border-r-2 ${BORDER_DATE} ${DATE_HEADER_BG} px-2 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Дата
            </th>
            <th
              className={`${MANAGER_COL} border-r ${BORDER_INNER} ${HEADER_BG} px-1.5 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Менеджер / задачи
            </th>
            <th
              className={`${OWNER_COL} border-r ${BORDER_INNER} ${HEADER_BG} px-1.5 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Светлана, руководитель
            </th>
            {data.masters.map((master) => (
              <th
                key={master.id}
                className={`${MASTER_COL} border-r ${BORDER_INNER} ${HEADER_BG} px-1.5 py-1.5 last:border-r-0`}
              >
                <div className="text-[10px] font-semibold leading-tight text-zinc-900">
                  {master.internalName}
                </div>
                <div className="text-[9px] leading-tight text-zinc-600">
                  {master.publicName}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((day, index) => (
            <ScheduleMonthRow
              key={day.dateKey}
              day={day}
              rowIndex={index}
              masters={data.masters}
              studioToday={data.studioToday}
              onCellOpen={onCellOpen}
              onManagerCellOpen={onManagerCellOpen}
              onOwnerCellOpen={onOwnerCellOpen}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
