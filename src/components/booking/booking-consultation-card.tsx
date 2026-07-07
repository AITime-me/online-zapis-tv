"use client";

import { bookingStudio, bookingStudioTelHref } from "@/components/booking/booking-config";
import { bookingTheme } from "@/components/booking/booking-theme";
import { BookingButton, BOOKING_SELECTABLE_CARD_CLASS } from "@/components/booking/booking-ui";

type BookingConsultationCardProps = {
  onRequestClick: () => void;
};

export function BookingConsultationCard({
  onRequestClick,
}: BookingConsultationCardProps) {
  return (
    <section className={BOOKING_SELECTABLE_CARD_CLASS}>
      <h3 className="font-display text-lg font-semibold" style={{ color: bookingTheme.green }}>
        Консультация
      </h3>
      <p className="font-body mt-2 text-base leading-relaxed" style={{ color: bookingTheme.textMuted }}>
        Если вы не уверены, какая процедура подойдёт, менеджер студии поможет
        подобрать услугу и мастера.
      </p>
      <div className="mt-4 space-y-3">
        <BookingButton type="button" onClick={onRequestClick} className="w-full">
          Оставить заявку
        </BookingButton>
        <a
          href={bookingStudioTelHref}
          className="home-btn home-btn-secondary font-body flex min-h-12 w-full items-center justify-center rounded-2xl border bg-white/92 px-6 py-3 text-base font-medium text-[var(--brand-green)] transition duration-300 ease-out"
        >
          Позвонить в студию
        </a>
      </div>
      <p className="font-body mt-2 text-center text-sm" style={{ color: bookingTheme.textMuted }}>
        {bookingStudio.phoneDisplay}
      </p>
    </section>
  );
}
