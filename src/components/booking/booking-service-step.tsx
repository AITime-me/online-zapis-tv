"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { BookingBackButton } from "@/components/booking/booking-back-button";
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
import { EMPTY_PROMOTION, getServiceCardPromotion } from "@/lib/booking/promotions";
import type {
  BookingCatalogCategory,
  BookingCatalogService,
} from "@/lib/booking/catalog-types";

type ServiceView = "categories" | "services";

type BookingServiceStepProps = {
  categories: BookingCatalogCategory[];
  initialView?: ServiceView;
  initialCategoryId?: string | null;
  onCategoryOpen?: (categoryId: string) => void;
  onBackToCategories?: () => void;
  onSelectService: (service: BookingCatalogService) => void;
  onManagerOnlyService: (service: BookingCatalogService) => void;
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
  onManagerOnlyService,
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
          <BookingStepEyebrow>Шаг 1</BookingStepEyebrow>
          <BookingStepTitle>Выберите направление</BookingStepTitle>
          <BookingStepDescription>Сначала категория — затем услуга</BookingStepDescription>
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category, index) => (
            <button
              key={category.id}
              type="button"
              onClick={() => openCategory(category)}
              className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} group flex min-h-14 w-full items-center justify-between gap-3 active:scale-[0.99]`}
              style={bookingSwayStyle(index)}
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
      <BookingBackButton onClick={backToCategories}>
        Назад к категориям
      </BookingBackButton>

      <header className="space-y-1">
        <BookingStepEyebrow>{selectedCategory?.name}</BookingStepEyebrow>
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
          className="font-body w-full rounded-2xl border bg-white/90 py-3.5 pl-12 pr-4 text-base outline-none transition focus:ring-2 focus:ring-[rgba(201,169,106,0.28)]"
          style={{ borderColor: "rgba(201, 169, 106, 0.34)", color: bookingTheme.green }}
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
          {filteredServices.map((service, index) => {
            const isManagerOnly = service.bookingMode === "MANAGER_ONLY";
            const promo = isManagerOnly
              ? EMPTY_PROMOTION
              : getServiceCardPromotion({
                  serviceId: service.id,
                  categoryName: selectedCategory?.name,
                });
            const hasPromotion = promo.isActive;

            if (isManagerOnly) {
              return (
                <li
                  key={service.id}
                  className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} opacity-95`}
                  style={bookingSwayStyle(index)}
                >
                  <div className="space-y-3">
                    <div>
                      <h3
                        className="text-lg font-semibold leading-snug md:text-xl"
                        style={{ color: bookingTheme.greenMuted }}
                      >
                        {service.publicName}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
                        {service.priceLabel && (
                          <span className="text-[#9ca3af]">
                            {service.priceLabel}
                          </span>
                        )}
                        <span
                          className="text-sm font-medium"
                          style={{ color: bookingTheme.goldMuted }}
                        >
                          {formatDuration(service.durationMinutes)}
                        </span>
                      </div>
                      <p
                        className="mt-3 text-sm font-medium"
                        style={{ color: bookingTheme.goldMuted }}
                      >
                        Запись через менеджера студии
                      </p>
                      {service.clientDescription && (
                        <p className="mt-3 text-base leading-relaxed text-[#6b7280]">
                          {service.clientDescription}
                        </p>
                      )}
                    </div>
                    <BookingButton
                      type="button"
                      onClick={() => onManagerOnlyService(service)}
                      className="w-full sm:w-auto sm:min-w-[180px]"
                    >
                      Оставить заявку
                    </BookingButton>
                  </div>
                </li>
              );
            }

            return (
            <li
              key={service.id}
              className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""}`}
              style={{
                ...bookingSwayStyle(index),
                ...(hasPromotion ? { borderColor: "rgba(201, 169, 106, 0.52)" } : {}),
              }}
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
