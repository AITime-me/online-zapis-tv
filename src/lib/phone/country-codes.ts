export type PhoneCountryId =
  | "RU"
  | "KZ"
  | "DE"
  | "BY"
  | "US"
  | "AE"
  | "TH"
  | "SE"
  | "CH"
  | "MT"
  | "EG"
  | "AM"
  | "GE"
  | "TR";

export type PhoneCountryOption = {
  id: PhoneCountryId;
  dialCode: string;
  shortLabel: string;
  listLabel: string;
};

export const PHONE_COUNTRY_OPTIONS: readonly PhoneCountryOption[] = [
  { id: "RU", dialCode: "+7", shortLabel: "+7", listLabel: "Россия +7" },
  { id: "KZ", dialCode: "+7", shortLabel: "+7", listLabel: "Казахстан +7" },
  { id: "DE", dialCode: "+49", shortLabel: "+49", listLabel: "Германия +49" },
  { id: "BY", dialCode: "+375", shortLabel: "+375", listLabel: "Беларусь +375" },
  { id: "US", dialCode: "+1", shortLabel: "+1", listLabel: "США +1" },
  { id: "AE", dialCode: "+971", shortLabel: "+971", listLabel: "ОАЭ +971" },
  { id: "TH", dialCode: "+66", shortLabel: "+66", listLabel: "Таиланд +66" },
  { id: "SE", dialCode: "+46", shortLabel: "+46", listLabel: "Швеция +46" },
  { id: "CH", dialCode: "+41", shortLabel: "+41", listLabel: "Швейцария +41" },
  { id: "MT", dialCode: "+356", shortLabel: "+356", listLabel: "Мальта +356" },
  { id: "EG", dialCode: "+20", shortLabel: "+20", listLabel: "Египет +20" },
  { id: "AM", dialCode: "+374", shortLabel: "+374", listLabel: "Армения +374" },
  { id: "GE", dialCode: "+995", shortLabel: "+995", listLabel: "Грузия +995" },
  { id: "TR", dialCode: "+90", shortLabel: "+90", listLabel: "Турция +90" },
] as const;

/** Значение селекта страны (уникальный id, не dial code). */
export type PhoneCountryCode = PhoneCountryId;

export const DEFAULT_PHONE_COUNTRY_CODE: PhoneCountryCode = "RU";

export function getPhoneCountryOption(
  countryCode: PhoneCountryCode,
): PhoneCountryOption {
  return (
    PHONE_COUNTRY_OPTIONS.find((option) => option.id === countryCode) ??
    PHONE_COUNTRY_OPTIONS[0]
  );
}

export function getDialCode(countryCode: PhoneCountryCode): string {
  return getPhoneCountryOption(countryCode).dialCode;
}

export function getPhonePlaceholder(countryCode: PhoneCountryCode): string {
  switch (countryCode) {
    case "RU":
    case "KZ":
      return "912 979-30-90";
    case "DE":
      return "151 23456789";
    case "BY":
      return "29 123-45-67";
    case "US":
      return "212 555-0123";
    case "AE":
      return "50 123 4567";
    case "TH":
      return "81 234 5678";
    case "SE":
      return "70 123 45 67";
    case "CH":
      return "79 123 45 67";
    case "MT":
      return "9912 3456";
    case "EG":
      return "10 1234 5678";
    case "AM":
      return "91 123456";
    case "GE":
      return "555 12 34 56";
    case "TR":
      return "532 123 4567";
    default:
      return "123 456 7890";
  }
}

/** @deprecated Используйте PHONE_COUNTRY_OPTIONS. */
export const PHONE_COUNTRY_CODES = PHONE_COUNTRY_OPTIONS.map((option) => ({
  value: option.id,
  label: option.listLabel,
  shortLabel: option.shortLabel,
}));
