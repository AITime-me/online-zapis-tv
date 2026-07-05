"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { bookingStudioTelHref } from "@/components/booking/booking-config";
import { bookingTheme } from "@/components/booking/booking-theme";
import type { PublicManageAppointmentView } from "@/services/BookingManageService";

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
      <dt className="shrink-0 text-base text-[#9ca3af]">{label}</dt>
      <dd
        className="text-right text-base font-medium leading-snug"
        style={{ color: bookingTheme.green }}
      >
        {value}
      </dd>
    </div>
  );
}

export function BookingManageClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [appointment, setAppointment] = useState<PublicManageAppointmentView | null>(
    null,
  );
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(
    token ? null : "Ссылка на запись недействительна",
  );
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadAppointment = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/booking/manage?token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        appointment?: PublicManageAppointmentView;
      };

      if (!response.ok || !data.ok || !data.appointment) {
        throw new Error(data.error ?? "Запись не найдена");
      }

      setAppointment(data.appointment);
    } catch (loadError) {
      setAppointment(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить запись",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAppointment();
  }, [loadAppointment]);

  const handleCancel = async () => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/booking/manage/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason: cancelReason }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        alreadyCancelled?: boolean;
        appointment?: PublicManageAppointmentView;
      };

      if (!response.ok || !data.ok || !data.appointment) {
        throw new Error(data.error ?? "Не удалось отменить запись");
      }

      setAppointment(data.appointment);
      setShowCancelConfirm(false);
      setCancelReason("");
      setActionMessage(
        data.alreadyCancelled
          ? "Запись уже была отменена ранее."
          : "Запись отменена.",
      );
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Не удалось отменить запись",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRescheduleRequest = async () => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/booking/manage/reschedule-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message: rescheduleMessage }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        appointment?: PublicManageAppointmentView;
      };

      if (!response.ok || !data.ok || !data.appointment) {
        throw new Error(data.error ?? "Не удалось отправить заявку");
      }

      setAppointment(data.appointment);
      setShowRescheduleForm(false);
      setRescheduleMessage("");
      setActionMessage(
        "Заявка на перенос отправлена. Менеджер студии свяжется с вами.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить заявку",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-base text-[#6b7280]">Ссылка на запись недействительна</p>
        <Link
          href="/booking"
          className="inline-flex min-h-12 items-center justify-center rounded-xl px-6 py-3 text-base font-medium text-white"
          style={{ backgroundColor: bookingTheme.green }}
        >
          Записаться онлайн
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="text-center text-base text-[#6b7280]">Загрузка…</p>
    );
  }

  if (error && !appointment) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-base text-[#6b7280]">{error}</p>
        <Link
          href="/booking"
          className="inline-flex min-h-12 items-center justify-center rounded-xl px-6 py-3 text-base font-medium text-white"
          style={{ backgroundColor: bookingTheme.green }}
        >
          Записаться онлайн
        </Link>
      </div>
    );
  }

  if (!appointment) {
    return null;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h2
          className="text-2xl font-semibold md:text-3xl"
          style={{ color: bookingTheme.green }}
        >
          Управление записью
        </h2>
        <p className="text-base text-[#6b7280]">{appointment.statusLabel}</p>
      </header>

      {actionMessage ? (
        <p
          className="rounded-xl border px-4 py-3 text-sm leading-relaxed"
          style={{
            borderColor: `${bookingTheme.gold}55`,
            backgroundColor: `${bookingTheme.gold}10`,
            color: bookingTheme.greenMuted,
          }}
        >
          {actionMessage}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section
        className="rounded-2xl border p-5 md:p-6"
        style={{
          borderColor: bookingTheme.border,
          backgroundColor: bookingTheme.card,
        }}
      >
        <dl className="divide-y" style={{ borderColor: bookingTheme.border }}>
          <DetailRow label="Услуга" value={appointment.serviceName} />
          <DetailRow label="Мастер" value={appointment.masterName} />
          <DetailRow label="Дата" value={appointment.dateLabel} />
          <DetailRow label="Время" value={appointment.timeLabel} />
          <DetailRow
            label="Длительность"
            value={formatDuration(appointment.durationMinutes)}
          />
          <DetailRow label="Статус" value={appointment.statusLabel} />
          <DetailRow label="Источник" value={appointment.sourceLabel} />
        </dl>
        {appointment.confirmationNote ? (
          <p className="mt-4 text-sm leading-relaxed text-[#6b7280]">
            {appointment.confirmationNote}
          </p>
        ) : null}
      </section>

      {appointment.canRequestReschedule ? (
        <section
          className="rounded-2xl border p-5 md:p-6"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.surface,
          }}
        >
          <h3
            className="text-base font-semibold"
            style={{ color: bookingTheme.green }}
          >
            Хотите перенести запись?
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">
            Если нужно изменить дату или время, отправьте заявку на перенос.
            Менеджер студии свяжется с вами.
          </p>
          {appointment.rescheduleRequested && !showRescheduleForm ? (
            <p className="mt-3 text-sm" style={{ color: bookingTheme.goldMuted }}>
              Заявка на перенос уже отправлена.
            </p>
          ) : null}
          {showRescheduleForm ? (
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-[#6b7280]">
                Напишите, на какой день или время вам удобно
              </label>
              <textarea
                value={rescheduleMessage}
                onChange={(event) => setRescheduleMessage(event.target.value)}
                rows={3}
                className="w-full rounded-xl border px-4 py-3 text-base outline-none focus:ring-2"
                style={{
                  borderColor: bookingTheme.border,
                  backgroundColor: bookingTheme.card,
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleRescheduleRequest()}
                  className="min-h-12 flex-1 rounded-xl px-5 py-3 text-base font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: bookingTheme.green }}
                >
                  Отправить заявку
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowRescheduleForm(false)}
                  className="min-h-12 flex-1 rounded-xl border px-5 py-3 text-base font-medium"
                  style={{
                    borderColor: bookingTheme.border,
                    color: bookingTheme.green,
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setShowRescheduleForm(true)}
              className="mt-4 min-h-12 w-full rounded-xl px-5 py-3 text-base font-medium transition hover:opacity-95 disabled:opacity-60"
              style={{
                backgroundColor: `${bookingTheme.gold}22`,
                color: bookingTheme.greenMuted,
              }}
            >
              Запросить перенос
            </button>
          )}
        </section>
      ) : null}

      <div className="space-y-3">
        {appointment.canCancel ? (
          showCancelConfirm ? (
            <div
              className="space-y-3 rounded-2xl border p-5"
              style={{ borderColor: bookingTheme.border }}
            >
              <p className="text-sm text-[#6b7280]">
                Вы уверены, что хотите отменить запись?
              </p>
              <label className="block text-sm text-[#6b7280]">
                Причина отмены (необязательно)
              </label>
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={2}
                className="w-full rounded-xl border px-4 py-3 text-base outline-none"
                style={{
                  borderColor: bookingTheme.border,
                  backgroundColor: bookingTheme.card,
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleCancel()}
                  className="min-h-12 flex-1 rounded-xl px-5 py-3 text-base font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: "#b45309" }}
                >
                  Подтвердить отмену
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowCancelConfirm(false)}
                  className="min-h-12 flex-1 rounded-xl border px-5 py-3 text-base font-medium"
                  style={{
                    borderColor: bookingTheme.border,
                    color: bookingTheme.green,
                  }}
                >
                  Назад
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setShowCancelConfirm(true)}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border px-5 py-3 text-base font-medium transition hover:bg-[#faf9f7] disabled:opacity-60"
              style={{
                borderColor: bookingTheme.border,
                color: bookingTheme.green,
              }}
            >
              Отменить запись
            </button>
          )
        ) : null}

        <Link
          href="/booking"
          className="flex min-h-12 w-full items-center justify-center rounded-xl px-5 py-3 text-base font-medium text-white"
          style={{ backgroundColor: bookingTheme.green }}
        >
          Записаться онлайн
        </Link>
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
      </div>
    </div>
  );
}
