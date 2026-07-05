"use client";

import { bookingTheme } from "@/components/booking/booking-theme";
import { BookingLegalConsentField } from "@/components/booking/booking-legal-links";
import {
  getPhonePlaceholder,
  PHONE_COUNTRY_CODES,
  type ClientDataFieldErrors,
  type PhoneCountryCode,
} from "@/lib/booking/client-validation";

type BookingClientFieldsProps = {
  name: string;
  onNameChange: (value: string) => void;
  countryCode: PhoneCountryCode;
  onCountryCodeChange: (value: PhoneCountryCode) => void;
  phoneLocal: string;
  onPhoneLocalChange: (value: string) => void;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  errors: ClientDataFieldErrors;
  onClearError?: (field: keyof ClientDataFieldErrors) => void;
  variant?: "booking" | "wizard";
  showConsent?: boolean;
};

const fieldErrorStyle = { color: bookingTheme.goldMuted };

export function BookingClientFields({
  name,
  onNameChange,
  countryCode,
  onCountryCodeChange,
  phoneLocal,
  onPhoneLocalChange,
  consent,
  onConsentChange,
  errors,
  onClearError,
  variant = "booking",
  showConsent = true,
}: BookingClientFieldsProps) {
  const isWizard = variant === "wizard";
  const inputClassName = isWizard
    ? "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-zinc-400"
    : "w-full rounded-xl border px-3 py-3 text-base outline-none focus:border-[#c4a35a]";
  const labelClassName = isWizard
    ? "mb-1 block text-zinc-700"
    : "mb-1 block text-[#4b5563]";
  const phoneSelectClassName = isWizard
    ? "w-[7.5rem] shrink-0 rounded-lg border px-2 py-2 text-sm outline-none focus:border-zinc-400 sm:w-32"
    : "w-[7.5rem] shrink-0 rounded-xl border px-2 py-3 text-sm outline-none focus:border-[#c4a35a] sm:w-32 sm:text-base";
  const phoneInputClassName = isWizard
    ? "min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-zinc-400"
    : "min-w-0 flex-1 rounded-xl border px-3 py-3 text-base outline-none focus:border-[#c4a35a]";
  const borderColor = (hasError: boolean) =>
    hasError
      ? bookingTheme.gold
      : isWizard
        ? "#dadce0"
        : bookingTheme.border;

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className={labelClassName}>Ваше имя</span>
        <input
          type="text"
          value={name}
          onChange={(event) => {
            onNameChange(event.target.value);
            onClearError?.("name");
          }}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "client-name-error" : undefined}
          className={inputClassName}
          style={{ borderColor: borderColor(Boolean(errors.name)) }}
          placeholder="Как к вам обращаться"
        />
        {errors.name && (
          <p
            id="client-name-error"
            className="mt-1.5 text-sm"
            style={fieldErrorStyle}
          >
            {errors.name}
          </p>
        )}
      </label>

      <div className="block text-sm">
        <span className={labelClassName}>Телефон</span>
        <div className="flex gap-2">
          <select
            value={countryCode}
            onChange={(event) => {
              onCountryCodeChange(event.target.value as PhoneCountryCode);
              onClearError?.("phone");
            }}
            aria-label="Код страны"
            className={phoneSelectClassName}
            style={{ borderColor: borderColor(Boolean(errors.phone)) }}
          >
            {PHONE_COUNTRY_CODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="tel"
            value={phoneLocal}
            onChange={(event) => {
              onPhoneLocalChange(event.target.value);
              onClearError?.("phone");
            }}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "client-phone-error" : undefined}
            className={phoneInputClassName}
            style={{ borderColor: borderColor(Boolean(errors.phone)) }}
            placeholder={getPhonePlaceholder(countryCode)}
          />
        </div>
        {errors.phone && (
          <p
            id="client-phone-error"
            className="mt-1.5 text-sm"
            style={fieldErrorStyle}
          >
            {errors.phone}
          </p>
        )}
      </div>

      {showConsent && (
        <div className="pt-1">
          <BookingLegalConsentField
            checked={consent}
            onChange={(value) => {
              onConsentChange(value);
              onClearError?.("consent");
            }}
            error={errors.consent}
            textColor={isWizard ? "#6b7280" : bookingTheme.textMuted}
          />
        </div>
      )}
    </div>
  );
}
