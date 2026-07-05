"use client";

import { useEffect, useMemo, useState } from "react";
import { BookingClientFields } from "@/components/booking/booking-client-fields";
import { BookingLegalConfirmNotice } from "@/components/booking/booking-legal-links";
import { bookingStudioTelHref } from "@/components/booking/booking-config";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  buildFullPhoneNumber,
  type ClientDataFieldErrors,
  isClientDataValid,
  type PhoneCountryCode,
  validateClientData,
} from "@/lib/booking/client-validation";
import type { BookingCatalogMaster } from "@/services/BookingService";

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
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>("+7");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ClientDataFieldErrors>({});
  const [success, setSuccess] = useState(false);

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const resetAndClose = () => {
    setName("");
    setCountryCode("+7");
    setPhoneLocal("");
    setComment("");
    setConsent(false);
    setError(null);
    setFieldErrors({});
    setSuccess(false);
    setSubmitting(false);
    onClose();
  };

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
    try {
      const response = await fetch("/api/booking/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: name.trim(),
          clientPhone: fullPhone,
          comment: comment || null,
          masterId: master?.id ?? null,
          type,
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
          setFieldErrors(data.fieldErrors);
        }
        throw new Error(data.error ?? "Не удалось отправить заявку");
      }
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 sm:p-4"
      role="presentation"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border shadow-lg"
        style={{
          borderColor: bookingTheme.border,
          backgroundColor: bookingTheme.card,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-request-title"
      >
        <header
          className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-4 sm:px-5"
          style={{ borderColor: bookingTheme.border }}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="booking-request-title"
              className="text-xl font-semibold leading-tight"
              style={{ color: bookingTheme.green }}
            >
              {title}
            </h2>
            {!success && master && (
              <p className="mt-1 text-sm text-[#9ca3af]">{master.publicName}</p>
            )}
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-[#9ca3af] transition hover:bg-[#faf9f7] hover:text-[#6b7280]"
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {success ? (
            <p className="text-center text-base leading-relaxed text-[#6b7280]">
              Менеджер студии свяжется с вами для подбора времени.
            </p>
          ) : (
            <>
              <p className="mb-4 text-base leading-relaxed text-[#6b7280]">
                Оставьте заявку, и менеджер студии свяжется с вами для подбора
                времени.
              </p>

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
              />

              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[#4b5563]">
                  Комментарий, необязательно
                </span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border px-3 py-3 text-base outline-none focus:border-[#c4a35a]"
                  style={{ borderColor: bookingTheme.border }}
                  placeholder="Удобное время для звонка или пожелания"
                />
              </label>

              {error && (
                <p
                  className="mt-3 text-sm"
                  style={{ color: bookingTheme.textMuted }}
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <footer
          className="shrink-0 space-y-3 border-t px-4 py-4 sm:px-5"
          style={{ borderColor: bookingTheme.border }}
        >
          {success ? (
            <button
              type="button"
              onClick={resetAndClose}
              className="min-h-12 w-full rounded-xl px-5 py-3 text-base font-medium text-white"
              style={{ backgroundColor: bookingTheme.green }}
            >
              Закрыть
            </button>
          ) : (
            <>
              <BookingLegalConfirmNotice actionLabel="Отправить заявку" />
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
                className="min-h-12 w-full rounded-xl px-5 py-3 text-base font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: bookingTheme.green }}
              >
                {submitting ? "Отправляем…" : "Отправить заявку"}
              </button>
              <a
                href={bookingStudioTelHref}
                className="flex min-h-12 w-full items-center justify-center rounded-xl border px-5 py-3 text-base font-medium"
                style={{
                  borderColor: bookingTheme.border,
                  color: bookingTheme.green,
                }}
              >
                Позвонить в студию
              </a>
              <button
                type="button"
                onClick={resetAndClose}
                className="min-h-12 w-full rounded-xl text-base font-medium text-[#6b7280] transition hover:bg-[#faf9f7]"
              >
                Отмена
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
