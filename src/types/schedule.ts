import type { AppliedPromotionRecord } from "@/types/applied-promotion";
import type { ScheduleDayBookingRequest } from "@/lib/schedule/booking-request-schedule";

export type { ScheduleDayBookingRequest };

export type ScheduleDayAppointment = {
  id: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  clientName: string;
  clientPhone: string;
  serviceName: string | null;
  comment: string | null;
  importantNote: string | null;
  isBold: boolean;
  isManualTimeOverride: boolean;
  status: string;
  source: string;
  statusCode: string;
  sourceCode: string;
  appliedPromotions: AppliedPromotionRecord[];
};

export type ScheduleDayBlock = {
  id: string;
  startsAt: string;
  endsAt: string;
  blockType: string;
  blockTypeLabel: string;
  internalReason: string | null;
  isFullDay: boolean;
};

export type ScheduleDayManagerNote = {
  id: string;
  content: string;
  createdAt: string;
};

export type ScheduleDayExtraWork = {
  id: string;
  startsAt: string;
  endsAt: string;
  isOnlineBookingEnabled: boolean;
};

export type ScheduleDayMaster = {
  id: string;
  internalName: string;
  publicName: string;
  appointments: ScheduleDayAppointment[];
  scheduleBlocks: ScheduleDayBlock[];
  extraWorkWindows?: ScheduleDayExtraWork[];
};

export type ScheduleDayData = {
  date: string;
  managerNotes: ScheduleDayManagerNote[];
  bookingRequests: ScheduleDayBookingRequest[];
  masters: ScheduleDayMaster[];
};
