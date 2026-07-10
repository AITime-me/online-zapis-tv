export const SERVICE_UNAVAILABLE_CODE = "SERVICE_UNAVAILABLE" as const;

export const ONLINE_SERVICE_UNAVAILABLE_MESSAGE =
  "Эта услуга временно недоступна. Пожалуйста, выберите другую услугу";

export type PublicBookingCreateErrorCode =
  | typeof SERVICE_UNAVAILABLE_CODE
  | "BOOKING_CREATE_ERROR"
  | "INVALID_JSON"
  | "MISSING_FIELDS"
  | "CLIENT_VALIDATION"
  | "INVALID_DATE"
  | "AppointmentConflictError"
  | "AppointmentValidationError"
  | "MANAGE_TOKEN_MISSING";

export type PublicBookingCreateErrorResponse = {
  ok: false;
  error: string;
  code?: PublicBookingCreateErrorCode | string;
  fieldErrors?: Record<string, string | undefined>;
};
