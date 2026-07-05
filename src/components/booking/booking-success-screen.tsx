"use client";

import Link from "next/link";
import { formatDateKeyLabel } from "@/lib/datetime/date-layer";
import { downloadBookingIcs } from "@/lib/booking/calendar-ics";
import {
  bookingStudio,
  bookingStudioTelHref,
} from "@/components/booking/booking-config";
import { BookingConfetti } from "@/components/booking/booking-confetti";
import { bookingTheme } from "@/components/booking/booking-theme";
import type {
  BookingCatalogMaster,
  BookingCatalogService,
} from "@/services/BookingService";

type BookingSuccessScreenProps = {
  service: BookingCatalogService;
  master: BookingCatalogMaster;
  dateKey: string;
  startTime: string;
};

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) {
    return `${hours} ч`;
  }
  return `${hours} ч ${rest} мин`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-base text-[#9ca3af]">{label}</dt>
      <dd
        className="text-right text-base font-medium leading-snug"
        style={{ color: bookingTheme.green }}
      >
        {value}
      </dd>
    </div>
  );
}

export function BookingSuccessScreen({
  service,
  master,
  dateKey,
  startTime,
}: BookingSuccessScreenProps) {
  const handleAddToCalendar = () => {
    downloadBookingIcs({
      dateKey,
      startTime,
      durationMinutes: service.durationMinutes,
      masterName: master.publicName,
      serviceName: service.publicName,
    });
  };

  return (
    <>
      <BookingConfetti />
      <div className="relative space-y-6">
        <header className="space-y-3 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl"
            style={{ backgroundColor: `${bookingTheme.gold}33` }}
            aria-hidden
          >
            ✓
          </div>
          <h2
            className="text-2xl font-semibold leading-tight md:text-3xl"
            style={{ color: bookingTheme.green }}
          >
            Вы записаны!
          </h2>
          <p className="text-base leading-relaxed text-[#6b7280] md:text-lg">
            Пусть это время будет только для вас ✨
          </p>
        </header>

        <section
          className="rounded-2xl border p-5 md:p-6"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.card,
          }}
        >
          <h3
            className="mb-1 text-sm font-medium uppercase tracking-[0.15em]"
            style={{ color: bookingTheme.gold }}
          >
            Детали записи
          </h3>
          <dl className="divide-y" style={{ borderColor: bookingTheme.border }}>
            <DetailRow label="Услуга" value={service.publicName} />
            <DetailRow label="Мастер" value={master.publicName} />
            <DetailRow label="Дата" value={formatDateKeyLabel(dateKey)} />
            <DetailRow label="Время" value={startTime} />
            <DetailRow
              label="Длительность"
              value={formatDuration(service.durationMinutes)}
            />
            {service.priceLabel && (
              <DetailRow label="Цена" value={service.priceLabel} />
            )}
          </dl>
        </section>

        <div className="space-y-3">
          <Link
            href="/booking"
            className="flex min-h-12 w-full items-center justify-center rounded-xl px-5 py-3 text-base font-medium text-white transition hover:opacity-95 active:scale-[0.99]"
            style={{ backgroundColor: bookingTheme.green }}
          >
            Записаться ещё раз
          </Link>
          <a
            href={bookingStudioTelHref}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border px-5 py-3 text-base font-medium transition hover:bg-[#faf9f7] active:scale-[0.99]"
            style={{
              borderColor: bookingTheme.border,
              color: bookingTheme.green,
            }}
          >
            Позвонить в студию
          </a>
          <button
            type="button"
            onClick={handleAddToCalendar}
            className="flex min-h-12 w-full items-center justify-center rounded-xl px-5 py-3 text-base font-medium transition hover:opacity-90 active:scale-[0.99]"
            style={{
              backgroundColor: `${bookingTheme.gold}22`,
              color: bookingTheme.greenMuted,
            }}
          >
            Добавить в календарь
          </button>
          <p className="pt-1 text-center text-sm text-[#9ca3af]">
            {bookingStudio.phoneDisplay}
          </p>
        </div>
      </div>
    </>
  );
}
