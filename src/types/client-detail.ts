import type {
  AppointmentStatus,
  BookingRequestSource,
  BookingRequestStatus,
  BookingRequestType,
  ClientStatus,
} from "@prisma/client";

export type ClientDetailClientDto = {
  id: string;
  fullName: string;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  source: string | null;
  status: ClientStatus;
  notes: string | null;
  tags: string[];
  isArchived: boolean;
  loyaltyLevel: string | null;
  bonusBalance: number;
  totalSpent: number;
  lastVisitAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  mergedIntoClientId: string | null;
  mergedIntoClientName: string | null;
  mergedAt: string | null;
  mergedByUserId: string | null;
  mergedByUserName: string | null;
  mergeNote: string | null;
  hasActiveDuplicate: boolean;
};

export type ClientDetailSummaryDto = {
  totalBookingRequests: number;
  activeBookingRequests: number;
  closedBookingRequests: number;
  totalAppointments: number;
  nextAppointmentAt: string | null;
  lastAppointmentAt: string | null;
  hasActiveDuplicate: boolean;
  bonusBalance: number;
};

export type ClientDetailBookingRequestDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  clientPhone: string;
  comment: string | null;
  status: BookingRequestStatus;
  type: BookingRequestType;
  source: BookingRequestSource;
  masterName: string | null;
  serviceNameSnapshot: string | null;
};

export type ClientDetailAppointmentDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  masterName: string;
  serviceName: string | null;
  status: AppointmentStatus;
  comment: string | null;
  importantNote: string | null;
};

export type ClientDetailMergedSourceDto = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  mergedAt: string | null;
};

export type ClientDetailMergeLogDto = {
  id: string;
  createdAt: string;
  reason: string | null;
  mergedByUserName: string | null;
  sourceClients: Array<{
    id: string;
    fullName: string;
    phone: string | null;
  }>;
};

export type ClientDetailDuplicateInfoDto = {
  hasActiveDuplicate: boolean;
  duplicatesSearchQuery: string;
};

export type ClientDetailResult = {
  client: ClientDetailClientDto;
  summary: ClientDetailSummaryDto;
  bookingRequests: ClientDetailBookingRequestDto[];
  bookingRequestsTruncated: boolean;
  appointments: ClientDetailAppointmentDto[];
  appointmentsTruncated: boolean;
  mergedClients: ClientDetailMergedSourceDto[];
  mergeLogs: ClientDetailMergeLogDto[];
  duplicateInfo: ClientDetailDuplicateInfoDto;
};
