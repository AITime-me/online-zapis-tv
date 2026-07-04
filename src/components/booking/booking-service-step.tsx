"use client";

import { useMemo, useState } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BookingPromotionBadge,
  BookingPromotionCardNote,
  BookingPromotionGeneralNotice,
} from "@/components/booking/booking-promotion-ui";
import {
  BOOKING_PROMOTIONS_GENERAL_NOTICE,
  getServiceCardPromotions,
} from "@/lib/booking/promotions";
import type {
  BookingCatalogCategory,
  BookingCatalogService,
} from "@/services/BookingService";

type ServiceView = "categories" | "services";

type BookingServiceStepProps = {
  categories: BookingCatalogCategory[];
  initialView?: ServiceView;
  initialCategoryId?: string | null;
  onCategoryOpen?: (categoryId: string) => void;
  onBackToCategories?: () => void;
  onSelectService: (service: BookingCatalogService) => void;
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

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 shrink-0 opacity-60"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
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

export function BookingServiceStep({
  categories,
  initialView = "categories",
  initialCategoryId = null,
  onCategoryOpen,
  onBackToCategories,
  onSelectService,
}: BookingServiceStepProps) {
  const [view, setView] = useState<ServiceView>(initialView);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    initialCategoryId,
  );
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  const filteredServices = useMemo(() => {
    if (!selectedCategory) {
      return [];
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return selectedCategory.services;
    }
    return selectedCategory.services.filter((service) =>
      service.publicName.toLowerCase().includes(query),
    );
  }, [selectedCategory, searchQuery]);

  const openCategory = (category: BookingCatalogCategory) => {
    setSelectedCategoryId(category.id);
    onCategoryOpen?.(category.id);
    setSearchQuery("");
    setView("services");
  };

  const backToCategories = () => {
    setView("categories");
    setSelectedCategoryId(null);
    onBackToCategories?.();
    setSearchQuery("");
  };

  if (categories.length === 0) {
    return (
      <p className="py-8 text-center text-base text-[#6b7280]">
        Сейчас нет услуг для онлайн-записи.
      </p>
    );
  }

  if (view === "categories") {
    return (
      <div className="space-y-6">
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
            Выберите направление
          </h2>
          <p className="text-base text-[#6b7280]">
            Сначала категория — затем услуга
          </p>
        </header>

        <BookingPromotionGeneralNotice text={BOOKING_PROMOTIONS_GENERAL_NOTICE} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => openCategory(category)}
              className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-left transition hover:shadow-md active:scale-[0.99]"
              style={{
                borderColor: bookingTheme.border,
                backgroundColor: bookingTheme.card,
              }}
            >
              <div className="min-w-0 flex-1">
                <span
                  className="block text-lg font-medium leading-snug"
                  style={{ color: bookingTheme.green }}
                >
                  {category.name}
                </span>
                <span className="mt-1 block text-sm text-[#9ca3af]">
                  {category.services.length}{" "}
                  {category.services.length === 1
                    ? "услуга"
                    : category.services.length < 5
                      ? "услуги"
                      : "услуг"}
                </span>
              </div>
              <span
                className="transition group-hover:translate-x-0.5"
                style={{ color: bookingTheme.gold }}
              >
                <ChevronRightIcon />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={backToCategories}
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
        Назад к категориям
      </button>

      <header className="space-y-1">
        <p
          className="text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: bookingTheme.gold }}
        >
          {selectedCategory?.name}
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

      {filteredServices.length === 0 ? (
        <p className="py-10 text-center text-base text-[#6b7280]">
          {searchQuery.trim()
            ? "Ничего не найдено. Попробуйте другое название."
            : "В этой категории пока нет услуг."}
        </p>
      ) : (
        <ul className="space-y-4">
          {filteredServices.map((service) => {
            const promotions = getServiceCardPromotions({
              serviceId: service.id,
              categoryName: selectedCategory?.name,
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
                    <BookingPromotionCardNote text={primaryPromotion.cardShortText} />
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
