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

/**
 * Полная формулировка согласия с тремя отдельными ссылками.
 * Ссылки намеренно вне <label>, чтобы клик по ним не отмечал чекбокс.
 */
export function BookingLegalConsentWording({
  consentId,
}: {
  consentId?: string;
}) {
  const LabelPart = ({ children }: { children: ReactNode }) =>
    consentId ? (
      <label htmlFor={consentId} className="cursor-pointer">
        {children}
      </label>
    ) : (
      <span>{children}</span>
    );

  return (
    <>
      <LabelPart>Я даю </LabelPart>
      <BookingLegalLink href={BOOKING_LEGAL_CONSENT_HREF}>
        согласие на обработку персональных данных
      </BookingLegalLink>
      <LabelPart>, подтверждаю ознакомление с </LabelPart>
      <BookingLegalLink href={BOOKING_LEGAL_PRIVACY_HREF}>
        политикой конфиденциальности
      </BookingLegalLink>
      <LabelPart> и принимаю условия </LabelPart>
      <BookingLegalLink href={BOOKING_LEGAL_TERMS_HREF}>
        публичной оферты
      </BookingLegalLink>
      <LabelPart>.</LabelPart>
    </>
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
      Нажимая «{actionLabel}», вы даёте{" "}
      <BookingLegalLink href={BOOKING_LEGAL_CONSENT_HREF}>
        согласие на обработку персональных данных
      </BookingLegalLink>
      , подтверждаете ознакомление с{" "}
      <BookingLegalLink href={BOOKING_LEGAL_PRIVACY_HREF}>
        политикой конфиденциальности
      </BookingLegalLink>{" "}
      и принимаете условия{" "}
      <BookingLegalLink href={BOOKING_LEGAL_TERMS_HREF}>
        публичной оферты
      </BookingLegalLink>
      .
    </p>
  );
}

type BookingLegalConsentFieldProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  textColor?: string;
};

export function BookingLegalConsentField({
  checked,
  onChange,
  error,
  textColor = bookingTheme.textMuted,
}: BookingLegalConsentFieldProps) {
  const consentId = useId();

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2.5 text-xs leading-relaxed sm:text-sm">
        <input
          id={consentId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-[#1a3d32]"
          style={{ borderColor: bookingTheme.border }}
          aria-invalid={Boolean(error)}
        />
        <div style={{ color: textColor }}>
          <BookingLegalConsentWording consentId={consentId} />
        </div>
      </div>
      {error && (
        <p className="pl-6 text-xs" style={{ color: bookingTheme.goldMuted }}>
          {error}
        </p>
      )}
    </div>
  );
}
