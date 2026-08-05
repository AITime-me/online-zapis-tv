/**
 * Internal bot availability contract (CURSOR-21).
 * Read-only S2S DTOs — no client PII, prices, or private entity metadata.
 */

export type BotAvailableDaysRequest = {
  serviceId: string;
  masterId: string;
  month: string;
};

export type BotSlotsRequest = {
  serviceId: string;
  masterId: string;
  date: string;
};

export type BotAvailabilitySlotDto = {
  slotId: string;
  serviceId: string;
  masterId: string;
  startsAt: string;
};

export type BotAvailableDaysSuccess = {
  ok: true;
  serviceId: string;
  masterId: string;
  month: string;
  studioToday: string;
  dateKeys: string[];
};

export type BotSlotsSuccess = {
  ok: true;
  serviceId: string;
  masterId: string;
  date: string;
  studioToday: string;
  slots: BotAvailabilitySlotDto[];
};

export type BotAvailabilityErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type BotAvailabilityErrorBody = {
  ok: false;
  code: BotAvailabilityErrorCode;
  error: string;
};
