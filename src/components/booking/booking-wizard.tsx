"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonthsToMonthKey,
  formatDateKeyLabel,
  formatMonthTitle,
  formatStudioTimeRange,
  getDaysInMonthKey,
  getWeekdayIndex,
  normalizeMonthKey,
} from "@/lib/datetime/date-layer";
import { BookingBackButton } from "@/components/booking/booking-back-button";
import { BookingServiceStep } from "@/components/booking/booking-service-step";
import { BookingConsultationCard } from "@/components/booking/booking-consultation-card";
import {
  BookingManagerRequestForm,
  type BookingRequestFormType,
} from "@/components/booking/booking-manager-request-form";
import {
  BookingMasterFirstStep,
  type MasterFirstView,
} from "@/components/booking/booking-master-first-step";
import {
  BookingPathToggle,
  type BookingPathMode,
} from "@/components/booking/booking-path-toggle";
import { BookingSuccessScreen } from "@/components/booking/booking-success-screen";
import { BookingClientFields } from "@/components/booking/booking-client-fields";
import { BookingLegalConfirmNotice } from "@/components/booking/booking-legal-links";
import {
  BookingPromotionConfirmBlock,
  BookingPromotionGeneralNotice,
  BookingRulesPriceSummary,
} from "@/components/booking/booking-promotion-ui";
import type { PublicClientContext } from "@/lib/client/client-context-engine";
import {
  buildFullPhoneNumber,
  isClientDataValid,
  type ClientDataFieldErrors,
  type PhoneCountryCode,
  validateClientContactFields,
  validateClientData,
} from "@/lib/booking/client-validation";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BOOKING_PROMOTIONS_GENERAL_NOTICE,
  evaluateBookingRules,
} from "@/lib/booking/promotions";
import type {
  BookingCatalogCategory,
  BookingCatalogMaster,
  BookingCatalogService,
} from "@/services/BookingService";

type Step = "service" | "master" | "date" | "time" | "confirm" | "success";

type BookingSelection = {
  service: BookingCatalogService | null;
  master: BookingCatalogMaster | null;
  dateKey: string | null;
  startTime: string | null;
  name: string;
  countryCode: PhoneCountryCode;
  phoneLocal: string;
  consent: boolean;
};

const EMPTY_CLIENT_FIELDS = {
  name: "",
  countryCode: "+7" as PhoneCountryCode,
  phoneLocal: "",
  consent: false,
};

const STEPS: { id: Step; label: string }[] = [
  { id: "service", label: "Услуга" },
  { id: "master", label: "Мастер" },
  { id: "date", label: "Дата" },
  { id: "time", label: "Время" },
  { id: "confirm", label: "Подтверждение" },
];

function stepIndex(step: Step): number {
  if (step === "success") {
    return STEPS.length;
  }
  return STEPS.findIndex((entry) => entry.id === step);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(
      "error" in data && typeof data.error === "string"
        ? data.error
        : "Ошибка загрузки",
    );
  }
  return data;
}

function findCategoryIdForService(
  categories: BookingCatalogCategory[],
  serviceId: string,
): string | null {
  for (const category of categories) {
    if (category.services.some((service) => service.id === serviceId)) {
      return category.id;
    }
  }
  return null;
}

export function BookingWizard() {
  const [step, setStep] = useState<Step>("service");
  const [bookingPath, setBookingPath] = useState<BookingPathMode>("by-service");
  const [categories, setCategories] = useState<BookingCatalogCategory[]>([]);
  const [masters, setMasters] = useState<BookingCatalogMaster[]>([]);
  const [allMasters, setAllMasters] = useState<BookingCatalogMaster[]>([]);
  const [masterServices, setMasterServices] = useState<BookingCatalogService[]>(
    [],
  );
  const [masterFirstView, setMasterFirstView] =
    useState<MasterFirstView>("masters");
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [monthKey, setMonthKey] = useState<string>("");
  const [studioToday, setStudioToday] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [stepLoading, setStepLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [serviceStepKey, setServiceStepKey] = useState(0);
  const [requestForm, setRequestForm] = useState<{
    type: BookingRequestFormType;
    master: BookingCatalogMaster | null;
  } | null>(null);
  const [selection, setSelection] = useState<BookingSelection>({
    service: null,
    master: null,
    dateKey: null,
    startTime: null,
    ...EMPTY_CLIENT_FIELDS,
  });
  const [clientFieldErrors, setClientFieldErrors] = useState<ClientDataFieldErrors>(
    {},
  );
  const [clientPromoContext, setClientPromoContext] =
    useState<PublicClientContext | null>(null);

  const confirmPhone = useMemo(
    () => buildFullPhoneNumber(selection.countryCode, selection.phoneLocal),
    [selection.countryCode, selection.phoneLocal],
  );

  const isConfirmPhoneValid = useMemo(() => {
    const phoneErrors = validateClientContactFields(selection.name, confirmPhone);
    return !phoneErrors.phone;
  }, [confirmPhone, selection.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson<{
          categories: BookingCatalogCategory[];
        }>("/api/booking/catalog");
        if (!cancelled) {
          setCategories(data.categories);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить услуги",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMasters = useCallback(async (serviceId: string) => {
    setStepLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ masters: BookingCatalogMaster[] }>(
        `/api/booking/masters?serviceId=${encodeURIComponent(serviceId)}`,
      );
      setMasters(data.masters);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить мастеров",
      );
    } finally {
      setStepLoading(false);
    }
  }, []);

  const loadAllMasters = useCallback(async () => {
    setStepLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ masters: BookingCatalogMaster[] }>(
        "/api/booking/masters",
      );
      setAllMasters(data.masters);
    } catch {
      setError("Не удалось загрузить мастеров. Попробуйте обновить страницу.");
    } finally {
      setStepLoading(false);
    }
  }, []);

  const loadMasterServices = useCallback(async (masterId: string) => {
    setStepLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ services: BookingCatalogService[] }>(
        `/api/booking/services?masterId=${encodeURIComponent(masterId)}`,
      );
      setMasterServices(data.services);
    } catch {
      setError("Не удалось загрузить услуги. Попробуйте обновить страницу.");
    } finally {
      setStepLoading(false);
    }
  }, []);

  const loadAvailableDays = useCallback(
    async (masterId: string, serviceId: string, month?: string | null) => {
      const monthParam = normalizeMonthKey(month);
      setStepLoading(true);
      setError(null);
      try {
        const data = await fetchJson<{
          dateKeys: string[];
          month: string;
          studioToday: string;
        }>(
          `/api/booking/available-days?masterId=${encodeURIComponent(masterId)}&serviceId=${encodeURIComponent(serviceId)}&month=${encodeURIComponent(monthParam)}`,
        );
        setAvailableDays(data.dateKeys);
        setMonthKey(data.month);
        setStudioToday(data.studioToday);
      } catch {
        setError("Не удалось загрузить даты. Попробуйте обновить страницу.");
      } finally {
        setStepLoading(false);
      }
    },
    [],
  );

  const loadSlots = useCallback(
    async (masterId: string, serviceId: string, dateKey: string) => {
      setStepLoading(true);
      setError(null);
      try {
        const data = await fetchJson<{ slots: string[]; studioToday: string }>(
          `/api/booking/slots?masterId=${encodeURIComponent(masterId)}&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateKey)}`,
        );
        setSlots(data.slots);
        setStudioToday(data.studioToday);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить время",
        );
      } finally {
        setStepLoading(false);
      }
    },
    [],
  );

  const resetBookingProgress = () => {
    setSelection({
      service: null,
      master: null,
      dateKey: null,
      startTime: null,
      ...EMPTY_CLIENT_FIELDS,
    });
    setClientFieldErrors({});
    setMasters([]);
    setMasterServices([]);
    setMasterFirstView("masters");
    setAvailableDays([]);
    setSlots([]);
    setSelectedCategoryId(null);
    setError(null);
  };

  const openManagerOnlyServiceRequest = (service: BookingCatalogService) => {
    if (!service.managerMasterId) {
      setRequestForm({ type: "CONSULTATION_REQUEST", master: null });
      return;
    }

    setRequestForm({
      type: "MANAGER_REQUEST",
      master: {
        id: service.managerMasterId,
        publicName: service.managerMasterName ?? service.publicName,
        clientDescription: null,
        photoUrl: null,
        isOnlineBookingEnabled: false,
      },
    });
  };

  const switchBookingPath = (mode: BookingPathMode) => {
    if (mode === bookingPath) {
      return;
    }
    setBookingPath(mode);
    setStep("service");
    resetBookingProgress();
    setServiceStepKey((key) => key + 1);
    if (mode === "by-master") {
      void loadAllMasters();
    }
  };

  const selectService = (service: BookingCatalogService) => {
    if (service.bookingMode === "MANAGER_ONLY") {
      openManagerOnlyServiceRequest(service);
      return;
    }

    setSelection({
      service,
      master: null,
      dateKey: null,
      startTime: null,
      ...EMPTY_CLIENT_FIELDS,
    });
    setMasters([]);
    setAvailableDays([]);
    setSlots([]);
    setStep("master");
    void loadMasters(service.id);
  };

  const selectMasterFirst = (master: BookingCatalogMaster) => {
    if (!master.isOnlineBookingEnabled) {
      return;
    }
    setSelection({
      service: null,
      master,
      dateKey: null,
      startTime: null,
      ...EMPTY_CLIENT_FIELDS,
    });
    setMasterServices([]);
    setAvailableDays([]);
    setSlots([]);
    setMasterFirstView("services");
    void loadMasterServices(master.id);
  };

  const selectServiceFromMaster = (service: BookingCatalogService) => {
    const masterId = selection.master?.id;
    setSelection((prev) => ({
      ...prev,
      service,
      dateKey: null,
      startTime: null,
      ...EMPTY_CLIENT_FIELDS,
    }));
    setAvailableDays([]);
    setSlots([]);
    setStep("date");
    if (masterId) {
      void loadAvailableDays(masterId, service.id, monthKey);
    }
  };

  const selectMaster = (master: BookingCatalogMaster) => {
    setSelection((prev) => ({
      ...prev,
      master,
      dateKey: null,
      startTime: null,
    }));
    setAvailableDays([]);
    setSlots([]);
    setStep("date");
    void loadAvailableDays(master.id, selection.service!.id, monthKey);
  };

  const selectDate = (dateKey: string) => {
    setSelection((prev) => ({
      ...prev,
      dateKey,
      startTime: null,
    }));
    setStep("time");
    void loadSlots(
      selection.master!.id,
      selection.service!.id,
      dateKey,
    );
  };

  const selectTime = (startTime: string) => {
    setSelection((prev) => ({ ...prev, startTime }));
    setStep("confirm");
  };

  const changeMonth = (delta: number) => {
    if (!selection.master || !selection.service || !monthKey) {
      return;
    }
    const nextMonth = addMonthsToMonthKey(monthKey, delta);
    void loadAvailableDays(
      selection.master.id,
      selection.service.id,
      nextMonth,
    );
  };

  const fullPhone = useMemo(
    () =>
      buildFullPhoneNumber(selection.countryCode, selection.phoneLocal),
    [selection.countryCode, selection.phoneLocal],
  );

  const clientData = useMemo(
    () => ({
      clientName: selection.name,
      clientPhone: fullPhone,
      consent: selection.consent,
    }),
    [fullPhone, selection.consent, selection.name],
  );

  const canSubmitBooking = useMemo(
    () => isClientDataValid(clientData) && !submitting,
    [clientData, submitting],
  );

  const submitBooking = async () => {
    if (
      !selection.service ||
      !selection.master ||
      !selection.dateKey ||
      !selection.startTime
    ) {
      return;
    }

    const validationErrors = validateClientData(clientData);
    setClientFieldErrors(validationErrors);

    if (validationErrors.name || validationErrors.phone || validationErrors.consent) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/booking/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selection.service.id,
          masterId: selection.master.id,
          date: selection.dateKey,
          startTime: selection.startTime,
          name: selection.name.trim(),
          phone: fullPhone,
          consent: true,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: ClientDataFieldErrors;
      };
      if (!response.ok || !data.ok) {
        if (data.fieldErrors) {
          setClientFieldErrors(data.fieldErrors);
        }
        throw new Error(data.error ?? "Не удалось создать запись");
      }
      setStep("success");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось создать запись",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const currentStepIndex = stepIndex(step);
  const availableDaySet = useMemo(
    () => new Set(availableDays),
    [availableDays],
  );

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategoryId) {
      return null;
    }
    return (
      categories.find((category) => category.id === selectedCategoryId)?.name ??
      null
    );
  }, [categories, selectedCategoryId]);

  const confirmPromoContext = useMemo(() => {
    if (!selection.service) {
      return null;
    }
    const categoryName =
      selectedCategoryName ??
      selection.service.categoryName ??
      (() => {
        const categoryId = findCategoryIdForService(
          categories,
          selection.service!.id,
        );
        return categoryId
          ? (categories.find((category) => category.id === categoryId)?.name ??
              null)
          : null;
      })();

    return {
      serviceId: selection.service.id,
      categoryId: selectedCategoryId ?? findCategoryIdForService(
        categories,
        selection.service.id,
      ),
      categoryName,
      basePrice: selection.service.basePrice,
    };
  }, [categories, selectedCategoryId, selectedCategoryName, selection.service]);

  useEffect(() => {
    if (step !== "confirm" || !isConfirmPhoneValid) {
      setClientPromoContext(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/booking/client-context", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: confirmPhone }),
          });
          const data = (await response.json()) as {
            ok?: boolean;
            context?: PublicClientContext;
          };

          if (!cancelled && data.ok && data.context) {
            setClientPromoContext(data.context);
            return;
          }

          if (!cancelled) {
            setClientPromoContext(null);
          }
        } catch {
          if (!cancelled) {
            setClientPromoContext(null);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [confirmPhone, isConfirmPhoneValid, step]);

  const bookingRulesResult = useMemo(() => {
    if (!selection.service || !confirmPromoContext) {
      return null;
    }

    return evaluateBookingRules({
      serviceId: confirmPromoContext.serviceId,
      categoryId: confirmPromoContext.categoryId,
      categoryName: confirmPromoContext.categoryName,
      basePrice: confirmPromoContext.basePrice,
      clientContext: clientPromoContext
        ? {
            isFirstVisit: clientPromoContext.isFirstVisit,
            isNewClient: clientPromoContext.isNewClient,
          }
        : undefined,
      client: {
        phone: confirmPhone.trim() ? confirmPhone : undefined,
      },
    });
  }, [
    clientPromoContext,
    confirmPhone,
    confirmPromoContext,
    selection.service,
  ]);

  const calendarDays = useMemo(() => {
    if (!monthKey) {
      return [];
    }
    const firstDateKey = `${monthKey}-01`;
    const startWeekday = (getWeekdayIndex(firstDateKey) + 6) % 7;
    const monthDays = getDaysInMonthKey(monthKey);
    const cells: Array<{ dateKey: string | null; label: string }> = [];

    for (let i = 0; i < startWeekday; i += 1) {
      cells.push({ dateKey: null, label: "" });
    }

    for (const dateKey of monthDays) {
      cells.push({ dateKey, label: String(Number(dateKey.slice(8, 10))) });
    }

    return cells;
  }, [monthKey]);

  if (loading) {
    return (
      <div
        className="rounded-2xl border p-10 text-center text-base text-[#6b7280]"
        style={{
          borderColor: bookingTheme.border,
          backgroundColor: bookingTheme.card,
        }}
      >
        Загрузка…
      </div>
    );
  }

  if (step === "success") {
    if (
      !selection.service ||
      !selection.master ||
      !selection.dateKey ||
      !selection.startTime
    ) {
      return null;
    }

    return (
      <div
        className="rounded-2xl border p-5 md:p-8"
        style={{
          borderColor: bookingTheme.border,
          backgroundColor: bookingTheme.card,
        }}
      >
        <BookingSuccessScreen
          service={selection.service}
          master={selection.master}
          dateKey={selection.dateKey}
          startTime={selection.startTime}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BookingManagerRequestForm
        open={requestForm != null}
        type={requestForm?.type ?? "MANAGER_REQUEST"}
        master={requestForm?.master}
        onClose={() => setRequestForm(null)}
      />
      <nav className="flex flex-wrap gap-2">
        {STEPS.map((entry, index) => {
          const isActive = entry.id === step;
          const isDone = index < currentStepIndex;
          return (
            <span
              key={entry.id}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                isActive
                  ? "text-white"
                  : isDone
                    ? "text-[#4b5563]"
                    : "text-[#9ca3af]"
              }`}
              style={
                isActive
                  ? { backgroundColor: bookingTheme.green }
                  : isDone
                    ? {
                        backgroundColor: `${bookingTheme.gold}33`,
                        color: bookingTheme.green,
                      }
                    : {
                        backgroundColor: bookingTheme.card,
                        border: `1px solid ${bookingTheme.border}`,
                      }
              }
            >
              {index + 1}. {entry.label}
            </span>
          );
        })}
      </nav>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div
        className="rounded-2xl border p-4 md:p-6"
        style={{
          borderColor: bookingTheme.border,
          backgroundColor: bookingTheme.card,
        }}
      >
        {step === "service" && (
          <div className="space-y-6">
            <BookingPathToggle
              value={bookingPath}
              onChange={switchBookingPath}
            />
            <BookingPromotionGeneralNotice
              text={BOOKING_PROMOTIONS_GENERAL_NOTICE}
            />
            {bookingPath === "by-service" ? (
              <BookingServiceStep
                key={serviceStepKey}
                categories={categories}
                initialView={selectedCategoryId ? "services" : "categories"}
                initialCategoryId={selectedCategoryId}
                onCategoryOpen={setSelectedCategoryId}
                onBackToCategories={() => setSelectedCategoryId(null)}
                onSelectService={selectService}
                onManagerOnlyService={openManagerOnlyServiceRequest}
              />
            ) : (
              <BookingMasterFirstStep
                masters={allMasters}
                services={masterServices}
                selectedMaster={selection.master}
                view={masterFirstView}
                loading={stepLoading}
                onSelectMaster={selectMasterFirst}
                onSelectService={selectServiceFromMaster}
                onBackToMasters={() => {
                  setMasterFirstView("masters");
                  setSelection((prev) => ({ ...prev, service: null }));
                  setMasterServices([]);
                }}
                onManagerRequest={(master) =>
                  setRequestForm({ type: "MANAGER_REQUEST", master })
                }
              />
            )}
            <BookingConsultationCard
              onRequestClick={() =>
                setRequestForm({
                  type: "CONSULTATION_REQUEST",
                  master: null,
                })
              }
            />
          </div>
        )}

        {step === "master" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                Выберите мастера
              </h2>
              <BookingBackButton
                onClick={() => {
                  const categoryId =
                    selectedCategoryId ??
                    (selection.service
                      ? findCategoryIdForService(
                          categories,
                          selection.service.id,
                        )
                      : null);
                  if (categoryId) {
                    setSelectedCategoryId(categoryId);
                  }
                  setServiceStepKey((key) => key + 1);
                  setStep("service");
                }}
              >
                Назад
              </BookingBackButton>
            </div>
            {stepLoading ? (
              <p className="text-sm text-zinc-500">Загрузка…</p>
            ) : masters.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Нет доступных мастеров для этой услуги.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {masters.map((master) => (
                  <button
                    key={master.id}
                    type="button"
                    onClick={() => selectMaster(master)}
                    className="rounded-lg border border-[#dadce0] px-4 py-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50"
                  >
                    <div className="font-medium text-zinc-900">
                      {master.publicName}
                    </div>
                    {master.clientDescription && (
                      <p className="mt-1 text-xs text-zinc-500">
                        {master.clientDescription}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "date" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                Выберите дату
              </h2>
              <BookingBackButton
                onClick={() => {
                  if (bookingPath === "by-master") {
                    setStep("service");
                    setMasterFirstView("services");
                    return;
                  }
                  setStep("master");
                }}
              >
                Назад
              </BookingBackButton>
            </div>
            {monthKey && (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => changeMonth(-1)}
                  className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
                >
                  ←
                </button>
                <span className="text-sm font-medium capitalize text-zinc-800">
                  {formatMonthTitle(monthKey)}
                </span>
                <button
                  type="button"
                  onClick={() => changeMonth(1)}
                  className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
                >
                  →
                </button>
              </div>
            )}
            {stepLoading ? (
              <p className="text-sm text-zinc-500">Загрузка календаря…</p>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-500">
                  {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
                    <div key={label} className="py-1 font-medium">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((cell, index) => {
                    if (!cell.dateKey) {
                      return <div key={`empty-${index}`} />;
                    }
                    const isAvailable = availableDaySet.has(cell.dateKey);
                    const isPast = Boolean(
                      studioToday && cell.dateKey < studioToday,
                    );
                    const isSelected = selection.dateKey === cell.dateKey;
                    return (
                      <button
                        key={cell.dateKey}
                        type="button"
                        disabled={!isAvailable || isPast}
                        onClick={() => selectDate(cell.dateKey!)}
                        className={`aspect-square rounded-lg text-sm transition ${
                          isSelected
                            ? "bg-zinc-900 text-white"
                            : isAvailable && !isPast
                              ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                              : "cursor-not-allowed text-zinc-300"
                        }`}
                      >
                        {cell.label}
                      </button>
                    );
                  })}
                </div>
                {availableDays.length === 0 && !stepLoading && (
                  <p className="text-sm text-zinc-500">
                    В этом месяце нет свободных дней. Попробуйте другой месяц.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {step === "time" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                Выберите время
              </h2>
              <BookingBackButton onClick={() => setStep("date")}>
                Назад
              </BookingBackButton>
            </div>
            {selection.dateKey && (
              <p className="text-sm text-zinc-600">
                {formatDateKeyLabel(selection.dateKey)}
              </p>
            )}
            {stepLoading ? (
              <p className="text-sm text-zinc-500">Загрузка слотов…</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Нет свободного времени в этот день.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => selectTime(slot)}
                    className="rounded-lg border border-[#dadce0] px-3 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                Подтверждение
              </h2>
              <BookingBackButton onClick={() => setStep("time")}>
                Назад
              </BookingBackButton>
            </div>
            <dl className="space-y-2 rounded-lg bg-zinc-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Услуга</dt>
                <dd className="text-right font-medium text-zinc-900">
                  {selection.service?.publicName}
                </dd>
              </div>
              {bookingRulesResult ? (
                <BookingRulesPriceSummary rulesResult={bookingRulesResult} />
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Мастер</dt>
                <dd className="text-right font-medium text-zinc-900">
                  {selection.master?.publicName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Дата и время</dt>
                <dd className="text-right font-medium text-zinc-900">
                  {selection.dateKey && formatDateKeyLabel(selection.dateKey)}{" "}
                  {selection.startTime}
                </dd>
              </div>
            </dl>
            <BookingPromotionConfirmBlock
              promotions={
                bookingRulesResult?.confirmSections.map((section) => ({
                  id: section.id,
                  title: section.title,
                  description: section.description,
                })) ?? []
              }
            />
            <BookingClientFields
              variant="wizard"
              name={selection.name}
              onNameChange={(value) =>
                setSelection((prev) => ({ ...prev, name: value }))
              }
              countryCode={selection.countryCode}
              onCountryCodeChange={(value) =>
                setSelection((prev) => ({ ...prev, countryCode: value }))
              }
              phoneLocal={selection.phoneLocal}
              onPhoneLocalChange={(value) =>
                setSelection((prev) => ({ ...prev, phoneLocal: value }))
              }
              consent={selection.consent}
              onConsentChange={(value) =>
                setSelection((prev) => ({ ...prev, consent: value }))
              }
              errors={clientFieldErrors}
              onClearError={(field) =>
                setClientFieldErrors((current) => ({
                  ...current,
                  [field]: undefined,
                }))
              }
            />
            <BookingLegalConfirmNotice />
            <button
              type="button"
              disabled={!canSubmitBooking}
              onClick={() => void submitBooking()}
              className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {submitting ? "Записываем…" : "Записаться"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
