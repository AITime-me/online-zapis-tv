import type {
  ScheduleDayAppointment,
  ScheduleDayBlock,
  ScheduleDayExtraWork,
  ScheduleDayManagerNote,
} from "@/types/schedule";

export type ScheduleMonthMaster = {
  id: string;
  internalName: string;
  publicName: string;
};

export type ScheduleMonthExtraWork = ScheduleDayExtraWork;

export type ScheduleMonthCellAppointment = ScheduleDayAppointment & {
  kind: "appointment";
};

export type ScheduleMonthCellBlock = ScheduleDayBlock & {
  kind: "block";
};

export type ScheduleMonthCellExtraWork = ScheduleMonthExtraWork & {
  kind: "extraWork";
};

export type ScheduleMonthCellItem =
  | ScheduleMonthCellAppointment
  | ScheduleMonthCellBlock
  | ScheduleMonthCellExtraWork;

export type ScheduleMonthDayCell = {
  dateKey: string;
  managerNotes: ScheduleDayManagerNote[];
  ownerNotes: ScheduleDayManagerNote[];
  masterCells: Record<string, ScheduleMonthCellItem[]>;
};

export type ScheduleMonthData = {
  month: string;
  studioToday: string;
  masters: ScheduleMonthMaster[];
  days: ScheduleMonthDayCell[];
};

export type QuickDayEditorData = {
  dateKey: string;
  masterId: string;
  masterInternalName: string;
  masterPublicName: string;
  appointments: ScheduleDayAppointment[];
  scheduleBlocks: ScheduleDayBlock[];
  extraWorkWindows: ScheduleMonthExtraWork[];
};

export type QuickManagerEditorData = {
  dateKey: string;
  notes: ScheduleDayManagerNote[];
};

export type QuickOwnerEditorData = {
  dateKey: string;
  notes: ScheduleDayManagerNote[];
};
