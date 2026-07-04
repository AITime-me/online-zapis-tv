"use client";

import { useMemo, useState } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BookingPromotionBadge,
  BookingPromotionCardNote,
} from "@/components/booking/booking-promotion-ui";
import { getServiceCardPromotions } from "@/lib/booking/promotions";
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
          <p
            className="text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: bookingTheme.gold }}
          >
            Шаг 1
          </p>
          <h2
            className="text-xl font-semibold leading-tight md:text-2xl"
            style={{ color: bookingTheme.green }}
          >
            Выберите мастера
          </h2>
          <p className="text-base text-[#6b7280]">
            Сначала мастер — затем услуга
          </p>
        </header>

        {loading ? (
          <p className="py-8 text-center text-base text-[#6b7280]">Загрузка…</p>
        ) : masters.length === 0 ? (
          <p className="py-8 text-center text-base text-[#6b7280]">
            Сейчас нет мастеров для онлайн-записи.
          </p>
        ) : (
          <ul className="space-y-3">
            {masters.map((master) => (
              <li key={master.id}>
                <button
                  type="button"
                  onClick={() => onSelectMaster(master)}
                  className="min-h-12 w-full rounded-2xl border px-5 py-4 text-left transition hover:shadow-sm active:scale-[0.99]"
                  style={{
                    borderColor: bookingTheme.border,
                    backgroundColor: bookingTheme.card,
                  }}
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
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBackToMasters}
        className="inline-flex min-h-12 items-center gap-1.5 text-base font-medium transition hover:opacity-80"
        style={{ color: bookingTheme.greenMuted }}
      >
        <svg
          aria-hidden
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Назад к мастерам
      </button>

      <header className="space-y-1">
        <p
          className="text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: bookingTheme.gold }}
        >
          {selectedMaster?.publicName}
        </p>
        <h2
          className="text-xl font-semibold leading-tight md:text-2xl"
          style={{ color: bookingTheme.green }}
        >
          Выберите услугу
        </h2>
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
          className="w-full rounded-2xl border border-[#e8e4de] bg-[#faf9f7] py-3.5 pl-12 pr-4 text-base outline-none transition focus:border-[#c4a35a] focus:ring-2 focus:ring-[#c4a35a]/30"
          style={{ color: bookingTheme.green }}
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
          {filteredServices.map((service) => {
            const promotions = getServiceCardPromotions({
              serviceId: service.id,
              categoryName: service.categoryName,
            });
            const primaryPromotion = promotions[0];
            const hasPromotion = Boolean(primaryPromotion);

            return (
              <li
                key={service.id}
                className="rounded-2xl border p-5"
                style={{
                  borderColor: hasPromotion
                    ? `${bookingTheme.gold}66`
                    : bookingTheme.border,
                  backgroundColor: hasPromotion
                    ? `${bookingTheme.gold}08`
                    : bookingTheme.card,
                }}
              >
                <div className="space-y-3">
                  <div>
                    {primaryPromotion && (
                      <div className="mb-3">
                        <BookingPromotionBadge text={primaryPromotion.badgeText} />
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
                    {primaryPromotion?.cardShortText && (
                      <BookingPromotionCardNote
                        text={primaryPromotion.cardShortText}
                      />
                    )}
                    {service.clientDescription && (
                      <p className="mt-3 text-base leading-relaxed text-[#6b7280]">
                        {service.clientDescription}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectService(service)}
                    className="min-h-12 w-full rounded-xl px-5 py-3 text-base font-medium text-white transition hover:opacity-95 active:scale-[0.99] sm:w-auto sm:min-w-[140px]"
                    style={{ backgroundColor: bookingTheme.green }}
                  >
                    Выбрать
                  </button>
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
