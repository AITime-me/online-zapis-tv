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
import {
  BookingPromotionConfirmBlock,
  BookingPromotionGeneralNotice,
  BookingRulesPriceSummary,
} from "@/components/booking/booking-promotion-ui";
import type { PublicClientContext } from "@/lib/client/client-context-engine";
import {
  buildFullPhoneNumber,
  type ClientDataFieldErrors,
  type PhoneCountryCode,
  validateClientContactFields,
  validateClientData,
} from "@/lib/booking/client-validation";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BookingButton,
  BookingPanel,
  BookingStepTitle,
  BOOKING_SELECTABLE_CARD_CLASS,
  bookingSwayStyle,
} from "@/components/booking/booking-ui";
import {
  DEFAULT_BOOKING_ERROR,
  readJsonResponse,
} from "@/lib/booking/api-response";
import { clientDebugLog, clientDebugWarn } from "@/lib/debug/client-debug";
import {
  BOOKING_PROMOTIONS_GENERAL_NOTICE,
  evaluateBookingRules,
} from "@/lib/booking/promotions";
import type { RulesEngineResult } from "@/lib/promo/rules-engine";
import type {
  BookingCatalogCategory,
  BookingCatalogMaster,
  BookingCatalogService,
} from "@/lib/booking/catalog-types";
import {
  ONLINE_SERVICE_UNAVAILABLE_MESSAGE,
  SERVICE_UNAVAILABLE_CODE,
} from "@/lib/booking/public-booking-errors";

type Step = "service" | "master" | "date" | "time" | "confirm" | "success";

type BookingSelection = {
  service: BookingCatalogService | null;
  master: BookingCatalogMaster | null;
  dateKey: string | null;
  startTime: string | null;
  name: string;
  countryCode: PhoneCountryCode;
  phoneLocal: string;
  comment: string;
  personalDataConsent: boolean;
  offerAcknowledgement: boolean;
};

const EMPTY_CLIENT_FIELDS = {
  name: "",
  countryCode: "RU" as PhoneCountryCode,
  phoneLocal: "",
  comment: "",
  personalDataConsent: false,
  offerAcknowledgement: false,
};

const STEPS: { id: Step; label: string }[] = [
  { id: "service", label: "Услуга" },
  { id: "master", label: "Мастер" },
  { id: "date", label: "Дата" },
  { id: "time", label: "Время" },
  { id: "confirm", label: "Подтверждение" },
];

const CATALOG_REFRESH_INTERVAL_MS = 45_000;

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

function isServiceInCatalog(
  categories: BookingCatalogCategory[],
  serviceId: string,
): boolean {
  return categories.some((category) =>
    category.services.some((service) => service.id === serviceId),
  );
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
    service: { id: string; publicName: string } | null;
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
  const [clientPromoContextReady, setClientPromoContextReady] = useState(false);
  const [successRulesResult, setSuccessRulesResult] =
    useState<RulesEngineResult | null>(null);
  const [successManageUrl, setSuccessManageUrl] = useState<string | null>(null);

  const resetWizard = useCallback(() => {
    setStep("service");
    setBookingPath("by-service");
    setSelection({
      service: null,
      master: null,
      dateKey: null,
      startTime: null,
      ...EMPTY_CLIENT_FIELDS,
    });
    setSuccessRulesResult(null);
    setSuccessManageUrl(null);
    setClientPromoContext(null);
    setClientPromoContextReady(false);
    setClientFieldErrors({});
    setError(null);
    setSelectedCategoryId(null);
    setServiceStepKey((key) => key + 1);
    setMasterFirstView("masters");
    setAvailableDays([]);
    setSlots([]);
  }, []);

  const confirmPhone = useMemo(
    () => buildFullPhoneNumber(selection.countryCode, selection.phoneLocal),
    [selection.countryCode, selection.phoneLocal],
  );

  useEffect(() => {
    const elements = document.querySelectorAll(".booking-fade-up");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -4% 0px" },
    );
    for (const element of elements) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [step]);

  const isConfirmPhoneValid = useMemo(() => {
    const phoneErrors = validateClientContactFields(selection.name, confirmPhone);
    return !phoneErrors.phone;
  }, [confirmPhone, selection.name]);

  const loadCatalog = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchJson<{
        categories: BookingCatalogCategory[];
      }>("/api/booking/catalog");
      setCategories(data.categories);
      return data.categories;
    } catch (loadError) {
      if (!options?.silent) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить услуги",
        );
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  const clearUnavailableServiceSelection = useCallback(
    (nextCategories: BookingCatalogCategory[], notifyIfRemoved: boolean) => {
      const selectedServiceId = selection.service?.id;
      if (!selectedServiceId) {
        return false;
      }
      if (isServiceInCatalog(nextCategories, selectedServiceId)) {
        return false;
      }
      setSelection((prev) => ({
        ...prev,
        service: null,
        master: null,
        dateKey: null,
        startTime: null,
      }));
      if (notifyIfRemoved) {
        setError(ONLINE_SERVICE_UNAVAILABLE_MESSAGE);
        setStep("service");
      }
      return true;
    },
    [selection.service?.id],
  );

  const refreshCatalog = useCallback(
    async (options?: { silent?: boolean; notifyIfRemoved?: boolean }) => {
      const nextCategories = await loadCatalog({
        silent: options?.silent ?? true,
      });
      if (!nextCategories) {
        return;
      }
      clearUnavailableServiceSelection(
        nextCategories,
        options?.notifyIfRemoved ?? false,
      );
    },
    [clearUnavailableServiceSelection, loadCatalog],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshCatalog({ silent: true, notifyIfRemoved: true });
      }
    };
    const onFocus = () => {
      void refreshCatalog({ silent: true, notifyIfRemoved: true });
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const intervalId = window.setInterval(() => {
      void refreshCatalog({ silent: true, notifyIfRemoved: true });
    }, CATALOG_REFRESH_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(intervalId);
    };
  }, [refreshCatalog]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

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
      setRequestForm({
        type: "CONSULTATION_REQUEST",
        master: null,
        service: { id: service.id, publicName: service.publicName },
      });
      return;
    }

    setRequestForm({
      type: "MANAGER_REQUEST",
      master: {
        id: service.managerMasterId,
        publicName: service.managerMasterName ?? "Мастер",
        clientDescription: null,
        photoUrl: null,
        isOnlineBookingEnabled: false,
      },
      service: { id: service.id, publicName: service.publicName },
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

  const canSubmitContact = useMemo(() => {
    const clientErrors = validateClientData({
      clientName: selection.name,
      clientPhone: fullPhone,
      personalDataConsent: selection.personalDataConsent,
      offerAcknowledgement: selection.offerAcknowledgement,
    });
    return (
      !clientErrors.name &&
      !clientErrors.phone &&
      !clientErrors.personalDataConsent &&
      !clientErrors.offerAcknowledgement
    );
  }, [
    fullPhone,
    selection.personalDataConsent,
    selection.offerAcknowledgement,
    selection.name,
  ]);

  const submitBooking = async () => {
    clientDebugLog("booking.submit", {
      step,
      hasService: Boolean(selection.service),
      hasMaster: Boolean(selection.master),
      hasDate: Boolean(selection.dateKey),
      hasTime: Boolean(selection.startTime),
      canSubmitContact,
    });

    if (
      !selection.service ||
      !selection.master ||
      !selection.dateKey ||
      !selection.startTime
    ) {
      clientDebugWarn("booking.submit.blocked", {
        reason: "incomplete-selection",
        hasService: Boolean(selection.service),
        hasMaster: Boolean(selection.master),
        hasDate: Boolean(selection.dateKey),
        hasTime: Boolean(selection.startTime),
      });
      return;
    }

    const validationErrors = validateClientData({
      clientName: selection.name,
      clientPhone: fullPhone,
      personalDataConsent: selection.personalDataConsent,
      offerAcknowledgement: selection.offerAcknowledgement,
    });
    setClientFieldErrors(validationErrors);

    if (
      validationErrors.name ||
      validationErrors.phone ||
      validationErrors.personalDataConsent ||
      validationErrors.offerAcknowledgement
    ) {
      clientDebugWarn("booking.submit.blocked", { reason: "client-validation" });
      return;
    }

    setSubmitting(true);
    setError(null);

    const createPayload = {
      serviceId: selection.service.id,
      masterId: selection.master.id,
      date: selection.dateKey,
      startTime: selection.startTime,
      name: selection.name.trim(),
      phone: fullPhone,
      comment: selection.comment.trim() || undefined,
      personalDataConsent: selection.personalDataConsent,
      offerAcknowledgement: selection.offerAcknowledgement,
    };

    clientDebugLog("booking.submit.request", { route: "/api/booking/create" });

    try {
      const response = await fetch("/api/booking/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });

      type CreateBookingResponse = {
        ok?: boolean;
        error?: string;
        code?: string;
        stack?: string;
        detail?: unknown;
        fieldErrors?: ClientDataFieldErrors;
        manageUrl?: string | null;
        appointment?: {
          serviceName: string | null;
          startsAt: string;
          status: string;
          source: string;
        };
      };

      const { data, parseError, rawText } = await readJsonResponse<CreateBookingResponse>(
        response,
      );

      if (parseError) {
        clientDebugWarn("booking.create.parse-error", {
          status: response.status,
        });
        throw new Error(parseError);
      }

      if (!data) {
        throw new Error(DEFAULT_BOOKING_ERROR);
      }

      if (!response.ok || data.ok !== true) {
        clientDebugWarn("booking.create.failed", {
          status: response.status,
          code: data.code ?? "unknown",
        });
        if (data.code === "RATE_LIMITED") {
          throw new Error(
            typeof data.error === "string" && data.error.trim()
              ? data.error
              : "Слишком много запросов. Пожалуйста, подождите немного и попробуйте снова",
          );
        }
        if (data.fieldErrors) {
          setClientFieldErrors(data.fieldErrors);
        }
        if (data.code === SERVICE_UNAVAILABLE_CODE) {
          void refreshCatalog({ silent: true, notifyIfRemoved: true });
        }
        throw new Error(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : DEFAULT_BOOKING_ERROR,
        );
      }

      setSuccessRulesResult(bookingRulesResult);
      setSuccessManageUrl(data.manageUrl ?? null);
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
      setClientPromoContextReady(false);
      return;
    }

    let cancelled = false;
    setClientPromoContextReady(false);

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

          if (!cancelled) {
            if (data.ok && data.context) {
              setClientPromoContext(data.context);
            } else {
              setClientPromoContext(null);
            }
            setClientPromoContextReady(true);
          }
        } catch {
          if (!cancelled) {
            setClientPromoContext(null);
            setClientPromoContextReady(true);
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

    const resolvedClientContext =
      clientPromoContextReady && clientPromoContext
        ? {
            isFirstVisit: clientPromoContext.isFirstVisit,
            isNewClient: clientPromoContext.isNewClient,
          }
        : undefined;

    return evaluateBookingRules({
      serviceId: confirmPromoContext.serviceId,
      categoryId: confirmPromoContext.categoryId,
      categoryName: confirmPromoContext.categoryName,
      basePrice: confirmPromoContext.basePrice,
      clientContext: resolvedClientContext,
      client: {
        phone: confirmPhone.trim() ? confirmPhone : undefined,
      },
    });
  }, [
    clientPromoContext,
    clientPromoContextReady,
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
      <BookingPanel className="booking-fade-up is-visible p-10 text-center">
        <p className="font-body text-base" style={{ color: bookingTheme.textMuted }}>
          Загрузка…
        </p>
      </BookingPanel>
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
      <BookingPanel className="booking-fade-up is-visible p-5 md:p-8">
        <BookingSuccessScreen
          service={selection.service}
          master={selection.master}
          dateKey={selection.dateKey}
          startTime={selection.startTime}
          rulesResult={successRulesResult}
          manageUrl={successManageUrl}
          onBookAgain={resetWizard}
        />
      </BookingPanel>
    );
  }

  return (
    <div className="booking-wizard booking-fade-up is-visible space-y-4 md:space-y-4">
      <BookingManagerRequestForm
        open={requestForm != null}
        type={requestForm?.type ?? "MANAGER_REQUEST"}
        master={requestForm?.master}
        service={requestForm?.service}
        onClose={() => setRequestForm(null)}
      />
      <nav className="booking-step-nav" aria-label="Шаги записи">
        {STEPS.map((entry, index) => {
          const isActive = entry.id === step;
          const isDone = index < currentStepIndex;
          return (
            <span
              key={entry.id}
              className={`booking-step-nav__item font-body rounded-full px-3 py-1.5 text-xs font-medium transition duration-300 ${
                isActive
                  ? "text-white"
                  : isDone
                    ? ""
                    : "text-[#9ca3af]"
              }`}
              style={
                isActive
                  ? { backgroundColor: bookingTheme.green }
                  : isDone
                    ? {
                        backgroundColor: "rgba(201, 169, 106, 0.22)",
                        color: bookingTheme.green,
                      }
                    : {
                        backgroundColor: bookingTheme.card,
                        border: `1px solid rgba(201, 169, 106, 0.34)`,
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

      <div className="booking-wizard-content">
      <BookingPanel>
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
                  setRequestForm({
                    type: "MANAGER_REQUEST",
                    master,
                    service: null,
                  })
                }
              />
            )}
            <BookingConsultationCard
              onRequestClick={() =>
                setRequestForm({
                  type: "CONSULTATION_REQUEST",
                  master: null,
                  service: null,
                })
              }
            />
          </div>
        )}

        {step === "master" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <BookingStepTitle>Выберите мастера</BookingStepTitle>
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
              <div className="grid gap-3 sm:grid-cols-2">
                {masters.map((master, index) => (
                  <button
                    key={master.id}
                    type="button"
                    onClick={() => selectMaster(master)}
                    className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} rounded-[1.25rem] px-4 py-3`}
                    style={bookingSwayStyle(index)}
                  >
                    <div className="font-body font-medium" style={{ color: bookingTheme.green }}>
                      {master.publicName}
                    </div>
                    {master.clientDescription && (
                      <p className="font-body mt-1 text-xs" style={{ color: bookingTheme.textMuted }}>
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
              <BookingStepTitle>Выберите дату</BookingStepTitle>
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
                  className="font-body rounded-xl border px-2 py-1 text-sm transition hover:bg-white/80"
                  style={{ borderColor: "rgba(201, 169, 106, 0.34)", color: bookingTheme.green }}
                >
                  ←
                </button>
                <span className="font-display text-sm font-medium capitalize" style={{ color: bookingTheme.green }}>
                  {formatMonthTitle(monthKey)}
                </span>
                <button
                  type="button"
                  onClick={() => changeMonth(1)}
                  className="font-body rounded-xl border px-2 py-1 text-sm transition hover:bg-white/80"
                  style={{ borderColor: "rgba(201, 169, 106, 0.34)", color: bookingTheme.green }}
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
                        className={`font-body aspect-square rounded-xl text-sm transition duration-200 ${
                          isSelected
                            ? "home-btn-primary text-white"
                            : isAvailable && !isPast
                              ? "border bg-white/90 hover:-translate-y-0.5"
                              : "cursor-not-allowed text-zinc-300"
                        }`}
                        style={
                          isSelected
                            ? undefined
                            : isAvailable && !isPast
                              ? {
                                  borderColor: "rgba(201, 169, 106, 0.34)",
                                  color: bookingTheme.green,
                                }
                              : undefined
                        }
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
              <BookingStepTitle>Выберите время</BookingStepTitle>
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
                {slots.map((slot, index) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => selectTime(slot)}
                    className={`${BOOKING_SELECTABLE_CARD_CLASS} ${index % 2 === 1 ? "booking-float-sway--alt" : ""} rounded-xl px-3 py-2 text-sm font-medium`}
                    style={{ ...bookingSwayStyle(index), color: bookingTheme.green }}
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
              <BookingStepTitle>Подтверждение</BookingStepTitle>
              <BookingBackButton onClick={() => setStep("time")}>
                Назад
              </BookingBackButton>
            </div>
            <dl
              className="space-y-2 rounded-[1.25rem] border p-4 text-sm"
              style={{
                borderColor: "rgba(201, 169, 106, 0.34)",
                backgroundColor: "rgba(255, 255, 255, 0.72)",
              }}
            >
              <div className="flex justify-between gap-4">
                <dt className="font-body" style={{ color: bookingTheme.textMuted }}>
                  Услуга
                </dt>
                <dd className="font-body text-right font-medium" style={{ color: bookingTheme.green }}>
                  {selection.service?.publicName}
                </dd>
              </div>
              {bookingRulesResult ? (
                <BookingRulesPriceSummary rulesResult={bookingRulesResult} />
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="font-body" style={{ color: bookingTheme.textMuted }}>
                  Мастер
                </dt>
                <dd className="font-body text-right font-medium" style={{ color: bookingTheme.green }}>
                  {selection.master?.publicName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-body" style={{ color: bookingTheme.textMuted }}>
                  Дата и время
                </dt>
                <dd className="font-body text-right font-medium" style={{ color: bookingTheme.green }}>
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
              comment={selection.comment}
              onCommentChange={(value) =>
                setSelection((prev) => ({ ...prev, comment: value }))
              }
              personalDataConsent={selection.personalDataConsent}
              onPersonalDataConsentChange={(value) =>
                setSelection((prev) => ({
                  ...prev,
                  personalDataConsent: value,
                }))
              }
              offerAcknowledgement={selection.offerAcknowledgement}
              onOfferAcknowledgementChange={(value) =>
                setSelection((prev) => ({
                  ...prev,
                  offerAcknowledgement: value,
                }))
              }
              errors={clientFieldErrors}
              onClearError={(field) =>
                setClientFieldErrors((current) => ({
                  ...current,
                  [field]: undefined,
                }))
              }
            />
            <BookingButton
              disabled={!canSubmitContact || submitting}
              onClick={() => void submitBooking()}
              className="w-full"
            >
              {submitting ? "Записываем…" : "Записаться"}
            </BookingButton>
          </div>
        )}
      </BookingPanel>
      </div>
    </div>
  );
}
