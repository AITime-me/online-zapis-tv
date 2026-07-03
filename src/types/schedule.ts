export type ScheduleDayAppointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  comment: string | null;
  importantNote: string | null;
  isBold: boolean;
  status: string;
  source: string;
};

export type ScheduleDayBlock = {
  id: string;
  startsAt: string;
  endsAt: string;
  blockType: string;
  blockTypeLabel: string;
  internalReason: string | null;
};

export type ScheduleDayManagerNote = {
  id: string;
  content: string;
  createdAt: string;
};

export type ScheduleDayMaster = {
  id: string;
  internalName: string;
  publicName: string;
  appointments: ScheduleDayAppointment[];
  scheduleBlocks: ScheduleDayBlock[];
};

export type ScheduleDayData = {
  date: string;
  managerNotes: ScheduleDayManagerNote[];
  masters: ScheduleDayMaster[];
};
