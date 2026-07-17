export const MIN_CLIENT_NAME_LENGTH = 2;
export const MIN_PHONE_DIGITS = 10;
export const MAX_PHONE_DIGITS = 15;

import {
  DEFAULT_PHONE_COUNTRY_CODE,
  getDialCode,
  getPhonePlaceholder,
  PHONE_COUNTRY_OPTIONS,
  type PhoneCountryCode,
} from "@/lib/phone/country-codes";

export type ClientDataFieldErrors = {
  name?: string;
  phone?: string;
  personalDataConsent?: string;
  offerAcknowledgement?: string;
};

export type ClientDataInput = {
  clientName: string;
  clientPhone: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
};

export {
  DEFAULT_PHONE_COUNTRY_CODE,
  getDialCode,
  getPhoneCountryOption,
  getPhonePlaceholder,
  PHONE_COUNTRY_CODES,
  PHONE_COUNTRY_OPTIONS,
  type PhoneCountryCode,
  type PhoneCountryId,
} from "@/lib/phone/country-codes";

export const CLIENT_DATA_PERSONAL_CONSENT_ERROR =
  "Необходимо согласие на обработку персональных данных";

export const CLIENT_DATA_OFFER_ACK_ERROR =
  "Необходимо подтвердить ознакомление с условиями записи и публичной офертой";

/** @deprecated Use CLIENT_DATA_PERSONAL_CONSENT_ERROR */
export const CLIENT_DATA_CONSENT_ERROR = CLIENT_DATA_PERSONAL_CONSENT_ERROR;

export function countPhoneDigits(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

export function normalizeLocalPhoneDigits(
  countryCode: PhoneCountryCode,
  localPhone: string,
): string {
  let digits = localPhone.replace(/\D/g, "");

  if (
    getDialCode(countryCode) === "+7" &&
    digits.length === 11 &&
    (digits.startsWith("7") || digits.startsWith("8"))
  ) {
    digits = digits.slice(1);
  }

  return digits;
}

export function buildFullPhoneNumber(
  countryCode: PhoneCountryCode,
  localPhone: string,
): string {
  const localDigits = normalizeLocalPhoneDigits(countryCode, localPhone);
  const codeDigits = getDialCode(countryCode).replace(/\D/g, "");

  if (!localDigits) {
    return "";
  }

  return `+${codeDigits}${localDigits}`;
}

export function isClientConsentGiven(value: unknown): boolean {
  return value === true;
}

export function validateClientContactFields(
  clientName: string,
  clientPhone: string,
): Pick<ClientDataFieldErrors, "name" | "phone"> {
  const errors: Pick<ClientDataFieldErrors, "name" | "phone"> = {};
  const name = clientName.trim();
  const phone = clientPhone.trim();
  const digitCount = countPhoneDigits(phone);

  if (name.length < MIN_CLIENT_NAME_LENGTH) {
    errors.name = "Введите имя";
  }

  if (!phone || digitCount === 0) {
    errors.phone = "Введите номер телефона";
  } else if (
    digitCount < MIN_PHONE_DIGITS ||
    digitCount > MAX_PHONE_DIGITS ||
    !/^\+\d+$/.test(phone)
  ) {
    errors.phone = "Номер введён некорректно";
  }

  return errors;
}

export function validateClientData(input: ClientDataInput): ClientDataFieldErrors {
  const errors: ClientDataFieldErrors = {
    ...validateClientContactFields(input.clientName, input.clientPhone),
  };

  if (!isClientConsentGiven(input.personalDataConsent)) {
    errors.personalDataConsent = CLIENT_DATA_PERSONAL_CONSENT_ERROR;
  }

  if (!isClientConsentGiven(input.offerAcknowledgement)) {
    errors.offerAcknowledgement = CLIENT_DATA_OFFER_ACK_ERROR;
  }

  return errors;
}

export function hasClientDataErrors(errors: ClientDataFieldErrors): boolean {
  return Boolean(
    errors.name ||
      errors.phone ||
      errors.personalDataConsent ||
      errors.offerAcknowledgement,
  );
}

export function isClientDataValid(input: ClientDataInput): boolean {
  return !hasClientDataErrors(validateClientData(input));
}

export function getFirstClientDataError(
  errors: ClientDataFieldErrors,
): string {
  return (
    errors.name ??
    errors.phone ??
    errors.personalDataConsent ??
    errors.offerAcknowledgement ??
    "Заполните обязательные поля"
  );
}
