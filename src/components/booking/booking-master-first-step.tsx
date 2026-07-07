"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { BookingBackButton } from "@/components/booking/booking-back-button";
import { bookingStudioTelHref } from "@/components/booking/booking-config";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BookingButton,
  BOOKING_SELECTABLE_CARD_CLASS,
  BookingStepDescription,
  BookingStepEyebrow,
  BookingStepTitle,
  bookingSwayStyle,
} from "@/components/booking/booking-ui";
import {
  BookingPromotionBadge,
  BookingPromotionCardNote,
} from "@/components/booking/booking-promotion-ui";
import { getServiceCardPromotion } from "@/lib/booking/promotions";
import type {
  BookingCatalogMaster,
  BookingCatalogService,
} from "@/services/BookingService";

type MasterFirstView = "masters" | "services";

type BookingMasterFirstStepProps = {
  masters: BookingCatalogMaster[];
  services: BookingCatalogService[];
  selectedMaster: BookingCatalogMaster | null;
  view: MasterFirstView;
  loading: boolean;
  onSelectMaster: (master: BookingCatalogMaster) => void;
  onSelectService: (service: BookingCatalogService) => void;
  onBackToMasters: () => void;
  onManagerRequest: (master: BookingCatalogMaster) => void;
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

function SearchIcon() {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 text-[#9ca3af]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}

export function BookingMasterFirstStep({
  masters,
  services,
  selectedMaster,
  view,
  loading,
  onSelectMaster,
  onSelectService,
  onBackToMasters,
  onManagerRequest,
}: BookingMasterFirstStepProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return services;
    }
    return services.filter((service) =>
      service.publicName.toLowerCase().includes(query),
    );
  }, [services, searchQuery]);

  if (view === "masters") {
    return (
      <div className="space-y-5">
        <header className="space-y-2 text-center md:text-left">
          <BookingStepEyebrow>Шаг 1</BookingStepEyebrow>
          <BookingStepTitle>Выберите мастера</BookingStepTitle>
          <BookingStepDescription>Сначала мастер — затем услуга</BookingStepDescription>
        </header>

        {loading ? (
          <p className="py-8 text-center text-base text-[#6b7280]">Загрузка…</p>
        ) : masters.length === 0 ? (
          <p className="py-8 text-center text-base text-[#6b7280]">
            Сейчас нет активных мастеров.
          </p>
        ) : (
          <ul className="space-y-3">
            {masters.map((master, index) => {
              const isOnline = master.isOnlineBookingEnabled;

              if (isOnline) {
                return (
                  <li key={master.id}>
                    <button
                      type="button"
                      onClick={() => onSelectMaster(master)}
                      className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} min-h-12 w-full active:scale-[0.99]`}
                      style={bookingSwayStyle(index)}
                    >
                      <span
                        className="block text-lg font-medium"
                        style={{ color: bookingTheme.green }}
                      >
                        {master.publicName}
                      </span>
                      {master.clientDescription && (
                        <span className="mt-1 block text-sm text-[#6b7280]">
                          {master.clientDescription}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }

              return (
                <li
                  key={master.id}
                  className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} opacity-95`}
                  style={bookingSwayStyle(index)}
                >
                  <span
                    className="block text-lg font-medium"
                    style={{ color: bookingTheme.greenMuted }}
                  >
                    {master.publicName}
                  </span>
                  {master.clientDescription && (
                    <span className="mt-1 block text-sm text-[#9ca3af]">
                      {master.clientDescription}
                    </span>
                  )}
                  <p
                    className="mt-3 text-sm font-medium"
                    style={{ color: bookingTheme.goldMuted }}
                  >
                    Запись через менеджера студии
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <BookingButton
                      type="button"
                      onClick={() => onManagerRequest(master)}
                      className="flex-1"
                    >
                      Оставить заявку
                    </BookingButton>
                    <a
                      href={bookingStudioTelHref}
                      className="home-btn home-btn-secondary font-body flex min-h-12 flex-1 items-center justify-center rounded-2xl border bg-white/92 px-4 py-3 text-base font-medium text-[var(--brand-green)] shadow-none"
                    >
                      Позвонить в студию
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BookingBackButton onClick={onBackToMasters}>
        Назад к мастерам
      </BookingBackButton>

      <header className="space-y-1">
        <BookingStepEyebrow>{selectedMaster?.publicName}</BookingStepEyebrow>
        <BookingStepTitle>Выберите услугу</BookingStepTitle>
      </header>

      <label className="relative block">
        <span className="sr-only">Поиск услуги</span>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Поиск по названию…"
          className="w-full rounded-2xl border border-[var(--brand-gold-border)] bg-[var(--brand-cream)] py-3.5 pl-12 pr-4 text-base text-[var(--brand-green)] outline-none transition focus:border-[var(--brand-gold)] focus:ring-2 focus:ring-[var(--brand-gold)]/25"
        />
      </label>

      {loading ? (
        <p className="py-8 text-center text-base text-[#6b7280]">Загрузка…</p>
      ) : filteredServices.length === 0 ? (
        <p className="py-10 text-center text-base text-[#6b7280]">
          {searchQuery.trim()
            ? "Ничего не найдено. Попробуйте другое название."
            : "У этого мастера пока нет услуг для онлайн-записи."}
        </p>
      ) : (
        <ul className="space-y-4">
          {filteredServices.map((service, index) => {
            const promo = getServiceCardPromotion({
              serviceId: service.id,
              categoryName: service.categoryName,
            });
            const hasPromotion = promo.isActive;

            return (
              <li
                key={service.id}
                className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} ${
                  hasPromotion ? "border-[var(--brand-gold)]/40 bg-[var(--brand-gold)]/[0.06]" : ""
                }`}
                style={bookingSwayStyle(index)}
              >
                <div className="space-y-3">
                  <div>
                    {promo.isActive && (
                      <div className="mb-3">
                        <BookingPromotionBadge text={promo.badgeText} />
                      </div>
                    )}
                    <h3
                      className="text-lg font-semibold leading-snug md:text-xl"
                      style={{ color: bookingTheme.green }}
                    >
                      {service.publicName}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
                      {service.priceLabel && (
                        <span className="text-[#9ca3af]">{service.priceLabel}</span>
                      )}
                      <span
                        className="text-sm font-medium"
                        style={{ color: bookingTheme.goldMuted }}
                      >
                        {formatDuration(service.durationMinutes)}
                      </span>
                    </div>
                    {promo.note && (
                      <BookingPromotionCardNote text={promo.note} />
                    )}
                    {service.clientDescription && (
                      <p className="mt-3 text-base leading-relaxed text-[#6b7280]">
                        {service.clientDescription}
                      </p>
                    )}
                  </div>
                  <BookingButton
                    type="button"
                    onClick={() => onSelectService(service)}
                    className="w-full sm:w-auto sm:min-w-[140px]"
                  >
                    Выбрать
                  </BookingButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export type { MasterFirstView };
