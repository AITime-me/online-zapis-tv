"use client";

import Link from "next/link";
import { formatDateKeyLabel } from "@/lib/datetime/date-layer";
import {
  bookingStudio,
  bookingStudioTelHref,
} from "@/components/booking/booking-config";
import { BookingConfetti } from "@/components/booking/booking-confetti";
import {
  BookingRulesConfirmBlock,
  BookingRulesPriceSummary,
} from "@/components/booking/booking-promotion-ui";
import {
  BookingButton,
  BookingPanel,
  BookingStepDescription,
  BookingStepEyebrow,
  BookingStepTitle,
} from "@/components/booking/booking-ui";
import { studioBrand } from "@/lib/brand/studio-brand";
import type { RulesEngineResult } from "@/lib/promo/rules-engine";
import type {
  BookingCatalogMaster,
  BookingCatalogService,
} from "@/services/BookingService";

type BookingSuccessScreenProps = {
  service: BookingCatalogService;
  master: BookingCatalogMaster;
  dateKey: string;
  startTime: string;
  rulesResult?: RulesEngineResult | null;
  manageUrl?: string | null;
  onBookAgain: () => void;
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
      <dt className="font-body shrink-0 text-base" style={{ color: studioBrand.inkMuted }}>
        {label}
      </dt>
      <dd
        className="font-body text-right text-base font-medium leading-snug"
        style={{ color: studioBrand.green }}
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
  rulesResult = null,
  manageUrl = null,
  onBookAgain,
}: BookingSuccessScreenProps) {
  const hasRulesPrice =
    rulesResult != null &&
    (rulesResult.price.originalLabel != null ||
      rulesResult.promos.length > 0 ||
      rulesResult.gifts.length > 0);

  return (
    <>
      <BookingConfetti />
      <div className="booking-fade-up relative space-y-6">
        <header className="space-y-3 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl"
            style={{ backgroundColor: `${studioBrand.gold}33`, color: studioBrand.green }}
            aria-hidden
          >
            ✓
          </div>
          <BookingStepTitle>Вы записаны!</BookingStepTitle>
          <BookingStepDescription>
            Пусть это время будет только для вас ✨
          </BookingStepDescription>
          <p className="font-body text-sm leading-relaxed" style={{ color: studioBrand.inkMuted }}>
            Запись ожидает подтверждения менеджером студии.
          </p>
        </header>

        <BookingPanel>
          <BookingStepEyebrow>Детали записи</BookingStepEyebrow>
          <dl className="divide-y" style={{ borderColor: studioBrand.goldLineSoft }}>
            <DetailRow label="Услуга" value={service.publicName} />
            <DetailRow label="Мастер" value={master.publicName} />
            <DetailRow label="Дата" value={formatDateKeyLabel(dateKey)} />
            <DetailRow label="Время" value={startTime} />
            <DetailRow
              label="Длительность"
              value={formatDuration(service.durationMinutes)}
            />
            {hasRulesPrice ? (
              <div className="py-3">
                <BookingRulesPriceSummary rulesResult={rulesResult} />
              </div>
            ) : service.priceLabel ? (
              <DetailRow label="Цена" value={service.priceLabel} />
            ) : null}
          </dl>
          {rulesResult?.confirmSections.length ? (
            <div className="mt-4">
              <BookingRulesConfirmBlock sections={rulesResult.confirmSections} />
            </div>
          ) : null}
        </BookingPanel>

        <div className="space-y-3">
          {manageUrl ? (
            <Link
              href={manageUrl}
              className="home-btn home-btn-primary font-body flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-3 text-base font-medium text-white transition duration-300 ease-out"
            >
              Отменить или перенести запись
            </Link>
          ) : null}
          <BookingButton variant="secondary" type="button" onClick={onBookAgain} className="w-full">
            Записаться ещё раз
          </BookingButton>
          <a
            href={bookingStudioTelHref}
            className="home-btn home-btn-secondary font-body flex min-h-12 w-full items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] transition duration-300 ease-out"
          >
            Позвонить в студию
          </a>
          <p className="font-body pt-1 text-center text-sm" style={{ color: studioBrand.inkMuted }}>
            {bookingStudio.phoneDisplay}
          </p>
        </div>
      </div>
    </>
  );
}
