"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { bookingTheme } from "@/components/booking/booking-theme";
import {
  BookingLegalLink,
  BOOKING_LEGAL_CONSENT_HREF,
  BOOKING_LEGAL_PRIVACY_HREF,
} from "@/components/booking/booking-legal-links";
import { PhoneCountrySelect } from "@/components/booking/phone-country-select";
import {
  buildFullPhoneNumber,
  DEFAULT_PHONE_COUNTRY_CODE,
  getPhonePlaceholder,
  type PhoneCountryCode,
} from "@/lib/booking/client-validation";
import {
  PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH,
  PROBLEM_REPORT_MAX_NAME_LENGTH,
} from "@/lib/problem-report/constants";

type FieldErrors = {
  name?: string;
  phone?: string;
  description?: string;
  personalDataConsent?: string;
};

export function ReportProblemEntry() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div
        className="mt-10 border-t pt-6 text-center"
        style={{ borderColor: bookingTheme.border }}
        data-testid="report-problem-entry"
      >
        <button
          ref={triggerRef}
          type="button"
          className="min-h-11 px-3 text-sm font-medium underline-offset-4 hover:underline"
          style={{ color: bookingTheme.textMuted }}
          onClick={() => setOpen(true)}
        >
          Сообщить о проблеме
        </button>
      </div>
      {open ? (
        <ReportProblemModal
          onClose={() => {
            setOpen(false);
            window.setTimeout(() => triggerRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </>
  );
}

function ReportProblemModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const [clientName, setClientName] = useState("");
  const [countryCode, setCountryCode] = useState<PhoneCountryCode>(
    DEFAULT_PHONE_COUNTRY_CODE,
  );
  const [localPhone, setLocalPhone] = useState("");
  const [description, setDescription] = useState("");
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Синхронный lock: state `pending` не успевает до второго клика/Enter. */
  const submitLockRef = useRef(false);
  const pendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  pendingRef.current = pending;
  onCloseRef.current = onClose;

  // Body scroll lock + initial focus — только при mount/unmount (не при pending).
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeButton = closeButtonRef.current;
    if (closeButton && !closeButton.disabled) {
      closeButton.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Escape + focus trap: стабильный listener, pending читаем через ref.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingRef.current) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const focusables = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitLockRef.current || pending || successMessage) {
      return;
    }
    submitLockRef.current = true;

    setFormError(null);
    setFieldErrors({});
    setPending(true);

    const clientPhone = buildFullPhoneNumber(countryCode, localPhone);
    let succeeded = false;

    try {
      const response = await fetch("/api/booking/problem-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientPhone,
          description,
          personalDataConsent,
          pagePath:
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : "/booking",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          viewportWidth:
            typeof window !== "undefined" ? window.innerWidth : 0,
          viewportHeight:
            typeof window !== "undefined" ? window.innerHeight : 0,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        fieldErrors?: FieldErrors;
      };

      if (!response.ok || !payload.ok) {
        setFieldErrors(payload.fieldErrors ?? {});
        setFormError(payload.error ?? "Не удалось отправить сообщение");
        return;
      }

      succeeded = true;
      setSuccessMessage(
        payload.message ??
          "Спасибо! Сообщение отправлено. Мы свяжемся с вами.",
      );
    } catch {
      setFormError("Не удалось отправить сообщение. Попробуйте позже.");
    } finally {
      setPending(false);
      // После успеха lock остаётся — повтор из этой модалки не нужен.
      if (!succeeded) {
        submitLockRef.current = false;
      }
    }
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending && !successMessage) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="report-problem-dialog"
        className="max-h-[min(92dvh,40rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-5"
        style={{ color: bookingTheme.green }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            Сообщить о проблеме
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-lg text-xl leading-none"
            style={{ color: bookingTheme.textMuted }}
            aria-label="Закрыть"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {successMessage ? (
          <div className="space-y-4" data-testid="report-problem-success">
            <p className="text-sm leading-relaxed">{successMessage}</p>
            <button
              type="button"
              className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: bookingTheme.green }}
              onClick={onClose}
            >
              Закрыть
            </button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={handleSubmit} noValidate>
            <label className="block space-y-1 text-sm">
              <span style={{ color: bookingTheme.textMuted }}>
                Имя (необязательно)
              </span>
              <input
                value={clientName}
                maxLength={PROBLEM_REPORT_MAX_NAME_LENGTH}
                onChange={(event) => setClientName(event.target.value)}
                className="min-h-11 w-full rounded-xl border px-3 py-2"
                style={{ borderColor: bookingTheme.border }}
                autoComplete="name"
              />
              {fieldErrors.name ? (
                <span className="text-xs" style={{ color: bookingTheme.goldMuted }}>
                  {fieldErrors.name}
                </span>
              ) : null}
            </label>

            <div className="space-y-1 text-sm">
              <span style={{ color: bookingTheme.textMuted }}>Телефон</span>
              <div className="flex gap-2">
                <PhoneCountrySelect
                  value={countryCode}
                  onChange={setCountryCode}
                  borderColor={bookingTheme.border}
                  className="min-h-11 rounded-xl border px-2 text-sm"
                />
                <input
                  value={localPhone}
                  onChange={(event) => setLocalPhone(event.target.value)}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder={getPhonePlaceholder(countryCode)}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border px-3 py-2"
                  style={{ borderColor: bookingTheme.border }}
                  aria-invalid={Boolean(fieldErrors.phone)}
                />
              </div>
              {fieldErrors.phone ? (
                <span className="text-xs" style={{ color: bookingTheme.goldMuted }}>
                  {fieldErrors.phone}
                </span>
              ) : null}
            </div>

            <label className="block space-y-1 text-sm">
              <span style={{ color: bookingTheme.textMuted }}>
                Описание проблемы
              </span>
              <textarea
                value={description}
                maxLength={PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                className="w-full rounded-xl border px-3 py-2"
                style={{ borderColor: bookingTheme.border }}
                aria-invalid={Boolean(fieldErrors.description)}
              />
              <span
                className="block text-right text-xs tabular-nums"
                style={{ color: bookingTheme.textMuted }}
              >
                {description.length}/{PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH}
              </span>
              {fieldErrors.description ? (
                <span className="text-xs" style={{ color: bookingTheme.goldMuted }}>
                  {fieldErrors.description}
                </span>
              ) : null}
            </label>

            <div className="space-y-1.5">
              <div className="flex items-start gap-2.5 text-xs leading-relaxed sm:text-sm">
                <input
                  id="problem-report-consent"
                  type="checkbox"
                  checked={personalDataConsent}
                  onChange={(event) =>
                    setPersonalDataConsent(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border accent-[#1a3d32]"
                  aria-invalid={Boolean(fieldErrors.personalDataConsent)}
                />
                <div style={{ color: bookingTheme.textMuted }}>
                  <label htmlFor="problem-report-consent" className="cursor-pointer">
                    Даю{" "}
                  </label>
                  <BookingLegalLink href={BOOKING_LEGAL_CONSENT_HREF}>
                    согласие на обработку персональных данных
                  </BookingLegalLink>
                  <label htmlFor="problem-report-consent" className="cursor-pointer">
                    {" "}
                    и подтверждаю ознакомление с{" "}
                  </label>
                  <BookingLegalLink href={BOOKING_LEGAL_PRIVACY_HREF}>
                    политикой обработки персональных данных
                  </BookingLegalLink>
                  <label htmlFor="problem-report-consent" className="cursor-pointer">
                    .
                  </label>
                </div>
              </div>
              {fieldErrors.personalDataConsent ? (
                <p className="pl-6 text-xs" style={{ color: bookingTheme.goldMuted }}>
                  {fieldErrors.personalDataConsent}
                </p>
              ) : null}
            </div>

            {formError ? (
              <p
                className="text-sm"
                role="alert"
                style={{ color: bookingTheme.goldMuted }}
                data-testid="report-problem-error"
              >
                {formError}
              </p>
            ) : null}

            <button
              ref={submitRef}
              type="submit"
              disabled={pending}
              data-testid="report-problem-submit"
              className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: bookingTheme.green }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                if (pending && event.key === "Enter") {
                  event.preventDefault();
                }
              }}
            >
              {pending ? "Отправка…" : "Отправить"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
