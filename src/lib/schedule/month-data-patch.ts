import type {
  ScheduleDayAppointment,
  ScheduleDayBlock,
} from "@/types/schedule";
import type {
  ScheduleMonthCellItem,
  ScheduleMonthData,
  ScheduleMonthExtraWork,
} from "@/types/schedule-month";
import { compareScheduleMonthCellItems } from "@/lib/schedule/datetime-guards";

export type CellSyncPayload = {
  dateKey: string;
  masterId: string;
  appointments: ScheduleDayAppointment[];
  scheduleBlocks: ScheduleDayBlock[];
  extraWorkWindows: ScheduleMonthExtraWork[];
};

function sortCellItems(items: ScheduleMonthCellItem[]): ScheduleMonthCellItem[] {
  return [...items].sort(compareScheduleMonthCellItems);
}

export function cellPayloadToMonthItems(
  payload: CellSyncPayload,
): ScheduleMonthCellItem[] {
  const items: ScheduleMonthCellItem[] = [
    ...payload.appointments.map(
      (appointment) =>
        ({ kind: "appointment", ...appointment }) as ScheduleMonthCellItem,
    ),
    ...payload.scheduleBlocks.map(
      (block) => ({ kind: "block", ...block }) as ScheduleMonthCellItem,
    ),
    ...payload.extraWorkWindows.map(
      (window) =>
        ({ kind: "extraWork", ...window }) as ScheduleMonthCellItem,
    ),
  ];
  return sortCellItems(items);
}

export function patchMonthDataCell(
  monthData: ScheduleMonthData,
  dateKey: string,
  masterId: string,
  items: ScheduleMonthCellItem[],
): ScheduleMonthData {
  return {
    ...monthData,
    days: monthData.days.map((day) =>
      day.dateKey === dateKey
        ? {
            ...day,
            masterCells: {
              ...day.masterCells,
              [masterId]: items,
            },
          }
        : day,
    ),
  };
}

export function countMonthAppointments(monthData: ScheduleMonthData): number {
  return monthData.days.reduce(
    (daySum, day) =>
      daySum +
      Object.values(day.masterCells).reduce(
        (cellSum, items) =>
          cellSum + items.filter((item) => item.kind === "appointment").length,
        0,
      ),
    0,
  );
}
