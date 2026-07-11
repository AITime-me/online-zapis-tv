import type {
  ScheduleAppointmentMasterFields,
  ScheduleAppointmentOperationalFields,
  ScheduleAppointmentViewOnlyFields,
} from "@/lib/schedule/appointment-contract";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";
import type { ScheduleDayBookingRequest } from "@/lib/schedule/booking-request-schedule";

export type { ScheduleDayBookingRequest };

export type ScheduleDayAppointment =
  | ScheduleAppointmentOperationalFields
  | ScheduleAppointmentMasterFields
  | ScheduleAppointmentViewOnlyFields;

export type ScheduleDayAppointmentOperational = ScheduleAppointmentOperationalFields;

export type ScheduleDayAppointmentMaster = ScheduleAppointmentMasterFields;

export type ScheduleDayAppointmentViewOnly = ScheduleAppointmentViewOnlyFields;

export type ScheduleDayAppointmentRestricted = ScheduleAppointmentViewOnlyFields;

export type { AppliedPromotionRecord };

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
