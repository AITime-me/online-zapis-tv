"use client";

import { bookingStudio, bookingStudioTelHref } from "@/components/booking/booking-config";
import { bookingTheme } from "@/components/booking/booking-theme";

type BookingConsultationCardProps = {
  onRequestClick: () => void;
};

export function BookingConsultationCard({
  onRequestClick,
}: BookingConsultationCardProps) {
  return (
    <section
      className="rounded-2xl border p-5"
      style={{
        borderColor: bookingTheme.border,
        backgroundColor: bookingTheme.surface,
      }}
    >
      <h3
        className="text-lg font-semibold"
        style={{ color: bookingTheme.green }}
      >
        Консультация
      </h3>
      <p className="mt-2 text-base leading-relaxed text-[#6b7280]">
        Если вы не уверены, какая процедура подойдёт, менеджер студии поможет
        подобрать услугу и мастера.
      </p>
      <div className="mt-4 space-y-3">
        <button
          type="button"
          onClick={onRequestClick}
          className="flex min-h-12 w-full items-center justify-center rounded-xl px-5 py-3 text-base font-medium text-white transition hover:opacity-95 active:scale-[0.99]"
          style={{ backgroundColor: bookingTheme.green }}
        >
          Оставить заявку
        </button>
        <a
          href={bookingStudioTelHref}
          className="flex min-h-12 w-full items-center justify-center rounded-xl border px-5 py-3 text-base font-medium transition hover:bg-white active:scale-[0.99]"
          style={{
            borderColor: bookingTheme.border,
            color: bookingTheme.green,
            backgroundColor: bookingTheme.card,
          }}
        >
          Позвонить в студию
        </a>
      </div>
      <p className="mt-2 text-center text-sm text-[#9ca3af]">
        {bookingStudio.phoneDisplay}
      </p>
    </section>
  );
}
