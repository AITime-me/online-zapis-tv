export const MIN_CLIENT_NAME_LENGTH = 2;
export const MIN_PHONE_DIGITS = 10;
export const MAX_PHONE_DIGITS = 15;

export type ClientDataFieldErrors = {
  name?: string;
  phone?: string;
  consent?: string;
};

export type ClientDataInput = {
  clientName: string;
  clientPhone: string;
  consent: boolean;
};

export const PHONE_COUNTRY_CODES = [
  { value: "+7", label: "+7 (Россия)" },
  { value: "+49", label: "+49 (Германия)" },
  { value: "+375", label: "+375 (Беларусь)" },
  { value: "+1", label: "+1 (США)" },
] as const;

export type PhoneCountryCode = (typeof PHONE_COUNTRY_CODES)[number]["value"];

export const CLIENT_DATA_CONSENT_ERROR =
  "Необходимо согласие на обработку персональных данных";

export function countPhoneDigits(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

export function normalizeLocalPhoneDigits(
  countryCode: PhoneCountryCode,
  localPhone: string,
): string {
  let digits = localPhone.replace(/\D/g, "");

  if (
    countryCode === "+7" &&
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
  const codeDigits = countryCode.replace(/\D/g, "");

  if (!localDigits) {
    return "";
  }

  return `+${codeDigits}${localDigits}`;
}

export function isClientConsentGiven(consent: unknown): boolean {
  return consent === true;
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

  if (!isClientConsentGiven(input.consent)) {
    errors.consent = CLIENT_DATA_CONSENT_ERROR;
  }

  return errors;
}

export function hasClientDataErrors(errors: ClientDataFieldErrors): boolean {
  return Boolean(errors.name || errors.phone || errors.consent);
}

export function isClientDataValid(input: ClientDataInput): boolean {
  return !hasClientDataErrors(validateClientData(input));
}

export function getPhonePlaceholder(countryCode: PhoneCountryCode): string {
  switch (countryCode) {
    case "+7":
      return "912 979-30-90";
    case "+49":
      return "151 23456789";
    case "+375":
      return "29 123-45-67";
    case "+1":
      return "212 555-0123";
    default:
      return "";
  }
}

export function getFirstClientDataError(
  errors: ClientDataFieldErrors,
): string {
  return (
    errors.name ??
    errors.phone ??
    errors.consent ??
    "Заполните обязательные поля"
  );
}
