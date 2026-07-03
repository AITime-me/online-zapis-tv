"use client";

import type {
  ScheduleMonthData,
  QuickDayEditorData,
  QuickManagerEditorData,
  QuickOwnerEditorData,
} from "@/types/schedule-month";
import { ScheduleMonthRow } from "@/components/schedule/schedule-month-row";
import {
  BORDER_DATE,
  BORDER_INNER,
  BORDER_OUTER,
  HEADER_BG,
  MANAGER_COL,
  MASTER_COL,
  OWNER_COL,
  STICKY_COLUMN_HEADER,
  STICKY_CORNER_HEADER,
  STICKY_SCROLL,
} from "@/components/schedule/schedule-month-table-styles";

export function ScheduleMonthTable({
  data,
  onCellOpen,
  onManagerCellOpen,
  onOwnerCellOpen,
  readOnly = false,
}: {
  data: ScheduleMonthData;
  onCellOpen?: (editorData: QuickDayEditorData) => void;
  onManagerCellOpen?: (editorData: QuickManagerEditorData) => void;
  onOwnerCellOpen?: (editorData: QuickOwnerEditorData) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      className={`${STICKY_SCROLL} border ${BORDER_OUTER} bg-white`}
      style={{ maxHeight: "calc(100vh - 120px)" }}
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-left">
        <thead className={HEADER_BG}>
          <tr className={`border-b ${BORDER_OUTER}`}>
            <th
              className={`${STICKY_CORNER_HEADER} border-b-2 border-r-2 ${BORDER_DATE} px-2 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Дата
            </th>
            <th
              className={`${STICKY_COLUMN_HEADER} ${MANAGER_COL} border-b-2 border-r ${BORDER_INNER} px-1.5 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Менеджер / задачи
            </th>
            <th
              className={`${STICKY_COLUMN_HEADER} ${OWNER_COL} border-b-2 border-r ${BORDER_INNER} px-1.5 py-1.5 text-[10px] font-semibold text-zinc-800`}
            >
              Светлана, руководитель
            </th>
            {data.masters.map((master) => (
              <th
                key={master.id}
                className={`${STICKY_COLUMN_HEADER} ${MASTER_COL} border-b-2 border-r ${BORDER_INNER} px-1.5 py-1.5 last:border-r-0`}
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
              readOnly={readOnly}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
