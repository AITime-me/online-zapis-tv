"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BookingClientFields } from "@/components/booking/booking-client-fields";
import { bookingStudioTelHref } from "@/components/booking/booking-config";
import {
  BookingButton,
  BookingStepDescription,
} from "@/components/booking/booking-ui";
import { studioBrand } from "@/lib/brand/studio-brand";
import {
  buildFullPhoneNumber,
  type ClientDataFieldErrors,
  isClientDataValid,
  type PhoneCountryCode,
  validateClientData,
} from "@/lib/booking/client-validation";
import type { BookingCatalogMaster } from "@/lib/booking/catalog-types";
import { BOOKING_REQUEST_SUCCESS_MESSAGE } from "@/lib/booking/request-success-copy";
import {
  buildIdempotencyHeaders,
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  resetIdempotencyKey,
} from "@/lib/booking-requests/idempotency-client";

export type BookingRequestFormType =
  | "MANAGER_REQUEST"
  | "CONSULTATION_REQUEST";

type BookingManagerRequestFormProps = {
  open: boolean;
  type: BookingRequestFormType;
  master?: BookingCatalogMaster | null;
  onClose: () => void;
};

export function BookingManagerRequestForm({
  open,
  type,
  master,
  onClose,
}: BookingManagerRequestFormProps) {
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("RU");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ClientDataFieldErrors>({});
  const [success, setSuccess] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !isMounted) {
      return;
    }

    getOrCreateIdempotencyKey(
      `booking:manager:${type}:${master?.id ?? "none"}`,
    );

    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isMounted, master?.id, open, type]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const fullPhone = useMemo(
    () => buildFullPhoneNumber(countryCode, phoneLocal),
    [countryCode, phoneLocal],
  );

  const clientData = useMemo(
    () => ({
      clientName: name,
      clientPhone: fullPhone,
      consent,
    }),
    [consent, fullPhone, name],
  );

  const canSubmit = useMemo(
    () => isClientDataValid(clientData) && !submitting,
    [clientData, submitting],
  );

  const resetAndClose = () => {
    setName("");
    setCountryCode("RU");
    setPhoneLocal("");
    setComment("");
    setConsent(false);
    setError(null);
    setFieldErrors({});
    setSuccess(false);
    setSubmitting(false);
    onClose();
  };

  if (!open || !isMounted) {
    return null;
  }

  const clearFieldError = (field: keyof ClientDataFieldErrors) => {
    setFieldErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  };

  const handleSubmit = async () => {
    const validationErrors = validateClientData(clientData);
    setFieldErrors(validationErrors);

    if (validationErrors.name || validationErrors.phone || validationErrors.consent) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const idempotencyScope = `booking:manager:${type}:${master?.id ?? "none"}`;
    try {
      const response = await fetch("/api/booking/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildIdempotencyHeaders(idempotencyScope),
        },
        body: JSON.stringify({
          clientName: name.trim(),
          clientPhone: fullPhone,
          comment: comment || null,
          masterId: master?.id ?? null,
          type,
          consent,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        fieldErrors?: ClientDataFieldErrors;
      };
      if (!response.ok || !data.ok) {
        if (data.code === "IDEMPOTENCY_CONFLICT") {
          resetIdempotencyKey(idempotencyScope);
        }
        if (data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
        }
        throw new Error(data.error ?? "Не удалось отправить заявку");
      }
      clearIdempotencyKey(idempotencyScope);
      setSuccess(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось отправить заявку",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = success
    ? "Заявка отправлена"
    : type === "CONSULTATION_REQUEST"
      ? "Консультация"
      : "Заявка через менеджера";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] items-center justify-center overflow-hidden bg-black/30 p-3 sm:p-4"
      role="presentation"
    >
      <div
        className="home-card home-card-info booking-float-panel booking-panel-premium flex max-h-full min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[1.75rem] border shadow-[0_18px_50px_rgba(28,46,38,0.12)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-request-title"
      >
        <header
          className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-4 sm:px-5"
          style={{ borderColor: studioBrand.goldLineSoft }}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="booking-request-title"
              className="font-display text-xl font-semibold leading-tight"
              style={{ color: studioBrand.green }}
            >
              {title}
            </h2>
            {!success && master && (
              <p className="font-body mt-1 text-sm" style={{ color: studioBrand.inkMuted }}>
                {master.publicName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition hover:bg-[var(--brand-cream)]"
            style={{ color: studioBrand.inkMuted }}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {success ? (
            <BookingStepDescription className="text-center">
              {BOOKING_REQUEST_SUCCESS_MESSAGE}
            </BookingStepDescription>
          ) : (
            <>
              <BookingStepDescription className="mb-4">
                Оставьте заявку, и менеджер студии свяжется с вами для подбора
                времени.
              </BookingStepDescription>

              <BookingClientFields
                name={name}
                onNameChange={setName}
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                phoneLocal={phoneLocal}
                onPhoneLocalChange={setPhoneLocal}
                consent={consent}
                onConsentChange={setConsent}
                errors={fieldErrors}
                onClearError={clearFieldError}
                showComment={false}
              />

              <label className="font-body mt-3 block text-sm">
                <span className="mb-1 block" style={{ color: studioBrand.greenMuted }}>
                  Комментарий, необязательно
                </span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-[var(--brand-gold-border)] bg-[var(--brand-cream)] px-3 py-3 text-base text-[var(--brand-green)] outline-none transition focus:border-[var(--brand-gold)] focus:ring-2 focus:ring-[var(--brand-gold)]/25"
                  placeholder="Удобное время для звонка или пожелания"
                />
              </label>

              {error && (
                <p className="font-body mt-3 text-sm" style={{ color: studioBrand.inkMuted }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <footer
          className="shrink-0 space-y-3 border-t px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5"
          style={{ borderColor: studioBrand.goldLineSoft }}
        >
          {success ? (
            <BookingButton type="button" onClick={resetAndClose} className="w-full">
              Закрыть
            </BookingButton>
          ) : (
            <>
              <BookingButton
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
                className="w-full"
              >
                {submitting ? "Отправляем…" : "Отправить заявку"}
              </BookingButton>
              <a
                href={bookingStudioTelHref}
                className="home-btn home-btn-secondary font-body flex min-h-12 w-full items-center justify-center rounded-2xl border bg-white/92 px-5 py-3 text-base font-medium text-[var(--brand-green)] shadow-none"
              >
                Позвонить в студию
              </a>
              <button
                type="button"
                onClick={resetAndClose}
                className="font-body min-h-12 w-full rounded-2xl text-base font-medium transition hover:bg-[var(--brand-cream)]"
                style={{ color: studioBrand.inkMuted }}
              >
                Отмена
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
