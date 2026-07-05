export {
  buildFullPhoneNumber,
  CLIENT_DATA_CONSENT_ERROR,
  countPhoneDigits,
  getFirstClientDataError,
  getPhonePlaceholder,
  hasClientDataErrors,
  isClientConsentGiven,
  isClientDataValid,
  normalizeLocalPhoneDigits,
  PHONE_COUNTRY_CODES,
  validateClientContactFields,
  validateClientData,
  type ClientDataFieldErrors,
  type ClientDataInput,
  type PhoneCountryCode,
} from "@/lib/booking/client-validation";

/** @deprecated Use ClientDataFieldErrors */
export type BookingRequestFieldErrors = import("@/lib/booking/client-validation").ClientDataFieldErrors;

/** @deprecated Use CLIENT_DATA_CONSENT_ERROR */
export { CLIENT_DATA_CONSENT_ERROR as BOOKING_PERSONAL_DATA_CONSENT_ERROR } from "@/lib/booking/client-validation";

/** @deprecated Use isClientConsentGiven */
export { isClientConsentGiven as isBookingLegalConsentGiven } from "@/lib/booking/client-validation";

/** @deprecated Use validateClientContactFields */
export { validateClientContactFields as validateBookingRequestClientFields } from "@/lib/booking/client-validation";

/** @deprecated Use isClientDataValid */
export {
  isClientDataValid as isBookingRequestFormValid,
} from "@/lib/booking/client-validation";

/** @deprecated Use hasClientDataErrors */
export { hasClientDataErrors as hasBookingRequestFieldErrors } from "@/lib/booking/client-validation";
