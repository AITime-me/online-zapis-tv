"use client";

import Link from "next/link";
import { useId } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";

export const bookingLegalLinkClassName =
  "font-medium underline decoration-[#c4a35a]/50 underline-offset-[3px] transition hover:decoration-[#c4a35a] active:opacity-80";

type BookingLegalLinksProps = {
  className?: string;
  privacyLabel?: string;
  termsLabel?: string;
};

export function BookingLegalLinks({
  className = "",
  privacyLabel = "политикой конфиденциальности",
  termsLabel = "публичной офертой",
}: BookingLegalLinksProps) {
  return (
    <span className={className}>
      <Link
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className={bookingLegalLinkClassName}
        style={{ color: bookingTheme.green }}
        onClick={(event) => event.stopPropagation()}
      >
        {privacyLabel}
      </Link>
      {" и "}
      <Link
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
        className={bookingLegalLinkClassName}
        style={{ color: bookingTheme.green }}
        onClick={(event) => event.stopPropagation()}
      >
        {termsLabel}
      </Link>
    </span>
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
      Нажимая «{actionLabel}», вы соглашаетесь с{" "}
      <BookingLegalLinks
        privacyLabel="политикой конфиденциальности"
        termsLabel="публичной офертой"
      />
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
          <label htmlFor={consentId} className="cursor-pointer">
            Я согласен(на) с{" "}
          </label>
          <BookingLegalLinks
            privacyLabel="политикой конфиденциальности"
            termsLabel="публичной офертой"
          />
          .
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
