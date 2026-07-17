"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useId } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BOOKING_LEGAL_CONSENT_HREF,
  BOOKING_LEGAL_PRIVACY_HREF,
  BOOKING_LEGAL_TERMS_HREF,
} from "@/lib/booking/legal-document-hrefs";

export {
  BOOKING_LEGAL_CONSENT_HREF,
  BOOKING_LEGAL_PRIVACY_HREF,
  BOOKING_LEGAL_TERMS_HREF,
} from "@/lib/booking/legal-document-hrefs";

export const bookingLegalLinkClassName =
  "font-medium underline decoration-[#c4a35a]/50 underline-offset-[3px] transition hover:decoration-[#c4a35a] active:opacity-80";

type BookingLegalLinkProps = {
  href: string;
  children: ReactNode;
};

export function BookingLegalLink({ href, children }: BookingLegalLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={bookingLegalLinkClassName}
      style={{ color: bookingTheme.green }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}

type LegalCheckboxFieldProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  textColor?: string;
  wording: (labelId: string) => ReactNode;
};

function LegalCheckboxField({
  checked,
  onChange,
  error,
  textColor = bookingTheme.textMuted,
  wording,
}: LegalCheckboxFieldProps) {
  const fieldId = useId();

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2.5 text-xs leading-relaxed sm:text-sm">
        <input
          id={fieldId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-[#1a3d32]"
          style={{ borderColor: bookingTheme.border }}
          aria-invalid={Boolean(error)}
        />
        <div style={{ color: textColor }}>{wording(fieldId)}</div>
      </div>
      {error ? (
        <p className="pl-6 text-xs" style={{ color: bookingTheme.goldMuted }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LabelPart({
  consentId,
  children,
}: {
  consentId: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={consentId} className="cursor-pointer">
      {children}
    </label>
  );
}

type BookingLegalConsentFieldsProps = {
  personalDataConsent: boolean;
  onPersonalDataConsentChange: (value: boolean) => void;
  offerAcknowledgement: boolean;
  onOfferAcknowledgementChange: (value: boolean) => void;
  personalDataConsentError?: string;
  offerAcknowledgementError?: string;
  textColor?: string;
};

/**
 * Два отдельных обязательных подтверждения (согласие на ПД отдельно от оферты).
 * Ссылки намеренно вне единого <label>, чтобы клик не отмечал чекбокс.
 */
export function BookingLegalConsentFields({
  personalDataConsent,
  onPersonalDataConsentChange,
  offerAcknowledgement,
  onOfferAcknowledgementChange,
  personalDataConsentError,
  offerAcknowledgementError,
  textColor = bookingTheme.textMuted,
}: BookingLegalConsentFieldsProps) {
  return (
    <div className="space-y-3">
      <LegalCheckboxField
        checked={personalDataConsent}
        onChange={onPersonalDataConsentChange}
        error={personalDataConsentError}
        textColor={textColor}
        wording={(id) => (
          <>
            <LabelPart consentId={id}>Даю </LabelPart>
            <BookingLegalLink href={BOOKING_LEGAL_CONSENT_HREF}>
              согласие на обработку персональных данных
            </BookingLegalLink>
            <LabelPart consentId={id}> и подтверждаю ознакомление с </LabelPart>
            <BookingLegalLink href={BOOKING_LEGAL_PRIVACY_HREF}>
              политикой обработки персональных данных
            </BookingLegalLink>
            <LabelPart consentId={id}>.</LabelPart>
          </>
        )}
      />

      <LegalCheckboxField
        checked={offerAcknowledgement}
        onChange={onOfferAcknowledgementChange}
        error={offerAcknowledgementError}
        textColor={textColor}
        wording={(id) => (
          <>
            <LabelPart consentId={id}>
              Ознакомился(ась) с условиями записи и{" "}
            </LabelPart>
            <BookingLegalLink href={BOOKING_LEGAL_TERMS_HREF}>
              публичной офертой
            </BookingLegalLink>
            <LabelPart consentId={id}>
              . Отправка формы является заявкой на бронирование и не означает
              автоматическое заключение договора — запись подтверждает студия.
            </LabelPart>
          </>
        )}
      />
    </div>
  );
}

type BookingLegalConfirmNoticeProps = {
  actionLabel?: string;
  className?: string;
};

export function BookingLegalConfirmNotice({
  actionLabel = "Записаться",
  className = "",
}: BookingLegalConfirmNoticeProps) {
  return (
    <p
      className={`text-xs leading-relaxed sm:text-sm ${className}`}
      style={{ color: bookingTheme.textMuted }}
    >
      Нажимая «{actionLabel}», подтвердите оба обязательных пункта выше:
      согласие на обработку{" "}
      <BookingLegalLink href={BOOKING_LEGAL_CONSENT_HREF}>
        персональных данных
      </BookingLegalLink>
      , ознакомление с{" "}
      <BookingLegalLink href={BOOKING_LEGAL_PRIVACY_HREF}>
        политикой
      </BookingLegalLink>{" "}
      и условиями{" "}
      <BookingLegalLink href={BOOKING_LEGAL_TERMS_HREF}>
        публичной оферты
      </BookingLegalLink>
      . Заявка ожидает подтверждения студией.
    </p>
  );
}
