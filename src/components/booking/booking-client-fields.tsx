"use client";

import { bookingTheme } from "@/components/booking/booking-theme";
import { BookingLegalConsentFields } from "@/components/booking/booking-legal-links";
import { PhoneCountrySelect } from "@/components/booking/phone-country-select";
import {
  getPhonePlaceholder,
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
  comment?: string;
  onCommentChange?: (value: string) => void;
  personalDataConsent: boolean;
  onPersonalDataConsentChange: (value: boolean) => void;
  offerAcknowledgement: boolean;
  onOfferAcknowledgementChange: (value: boolean) => void;
  errors: ClientDataFieldErrors;
  onClearError?: (field: keyof ClientDataFieldErrors) => void;
  variant?: "booking" | "wizard";
  showConsent?: boolean;
  showComment?: boolean;
};

const fieldErrorStyle = { color: bookingTheme.goldMuted };

export function BookingClientFields({
  name,
  onNameChange,
  countryCode,
  onCountryCodeChange,
  phoneLocal,
  onPhoneLocalChange,
  comment = "",
  onCommentChange,
  personalDataConsent,
  onPersonalDataConsentChange,
  offerAcknowledgement,
  onOfferAcknowledgementChange,
  errors,
  onClearError,
  variant = "booking",
  showConsent = true,
  showComment = true,
}: BookingClientFieldsProps) {
  const isWizard = variant === "wizard";
  const inputClassName = isWizard
    ? "font-body w-full rounded-2xl border bg-white/92 px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]"
    : "font-body w-full rounded-2xl border bg-white/92 px-3 py-3 text-base outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]";
  const labelClassName = isWizard
    ? "font-body mb-1 block"
    : "font-body mb-1 block";
  const phoneSelectClassName = isWizard
    ? "font-body inline-flex min-w-[4.5rem] items-center justify-between rounded-2xl border bg-white/92 px-2 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]"
    : "font-body inline-flex min-w-[4.5rem] items-center justify-between rounded-2xl border bg-white/92 px-2 py-3 text-sm outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)] sm:text-base";
  const phoneInputClassName = isWizard
    ? "font-body min-w-0 flex-1 rounded-2xl border bg-white/92 px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]"
    : "font-body min-w-0 flex-1 rounded-2xl border bg-white/92 px-3 py-3 text-base outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]";
  const borderColor = (hasError: boolean) =>
    hasError ? bookingTheme.gold : "rgba(201, 169, 106, 0.34)";

  return (
    <div className="space-y-3">
      <label className="font-body block text-sm" style={{ color: bookingTheme.greenMuted }}>
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
          <PhoneCountrySelect
            value={countryCode}
            onChange={(nextValue) => {
              onCountryCodeChange(nextValue);
              onClearError?.("phone");
            }}
            borderColor={borderColor(Boolean(errors.phone))}
            className={phoneSelectClassName}
          />
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

      {showComment && onCommentChange ? (
        <label className="font-body block text-sm" style={{ color: bookingTheme.greenMuted }}>
          <span className={labelClassName}>Комментарий</span>
          <textarea
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            rows={isWizard ? 2 : 3}
            className={`${inputClassName} resize-y`}
            style={{ borderColor: borderColor(false) }}
            placeholder="Необязательно: пожелания или уточнения к записи"
          />
        </label>
      ) : null}

      {showConsent ? (
        <div className="pt-1">
          <BookingLegalConsentFields
            personalDataConsent={personalDataConsent}
            onPersonalDataConsentChange={(value) => {
              onPersonalDataConsentChange(value);
              onClearError?.("personalDataConsent");
            }}
            offerAcknowledgement={offerAcknowledgement}
            onOfferAcknowledgementChange={(value) => {
              onOfferAcknowledgementChange(value);
              onClearError?.("offerAcknowledgement");
            }}
            personalDataConsentError={errors.personalDataConsent}
            offerAcknowledgementError={errors.offerAcknowledgement}
            textColor={isWizard ? "#6b7280" : bookingTheme.textMuted}
          />
        </div>
      ) : null}
    </div>
  );
}
