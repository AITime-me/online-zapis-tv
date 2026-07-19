"use client";

import { useState } from "react";
import type { BookingRequestStatus } from "@prisma/client";
import Link from "next/link";
import { formatStudioTime, normalizeDate } from "@/lib/datetime/date-layer";
import { getStudioNow } from "@/lib/datetime/date-layer";
import {
  extractGiftFromBookingComment,
  getBookingRequestCommentPreview,
  getScheduleBookingRequestShortSourceLabel,
  getScheduleBookingRequestSourceLabel,
  isFullScheduleBookingRequest,
  truncateScheduleText,
} from "@/lib/schedule/booking-request-schedule";
import {
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
} from "@/lib/booking-requests/booking-request-contract";
import type { ScheduleDayBookingRequest } from "@/types/schedule";

export type ScheduleBookingRequestDetailLevel = "full" | "sanitized";

function formatRequestDateTime(value: string): string {
  const date = normalizeDate(value) ?? getStudioNow();
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function BookingRequestAppointmentContext({
  request,
}: {
  request: ScheduleDayBookingRequest;
}) {
  if (request.type !== "RESCHEDULE_REQUEST") {
    return null;
  }

  const appointmentStartsAt =
    "appointmentStartsAt" in request ? request.appointmentStartsAt : null;
  const appointmentScheduleHref =
    "appointmentScheduleHref" in request
      ? request.appointmentScheduleHref
      : null;

  const when = appointmentStartsAt
    ? formatRequestDateTime(appointmentStartsAt)
    : null;

  return (
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50/70 px-3 py-2">
      <div className="text-xs font-semibold text-amber-900">Перенос записи</div>
      {request.appointmentServiceName ? (
        <div>
          <div className="text-xs text-zinc-500">Услуга</div>
          <div className="text-zinc-900">{request.appointmentServiceName}</div>
        </div>
      ) : null}
      {when ? (
        <div>
          <div className="text-xs text-zinc-500">Прежние дата и время</div>
          <div className="tabular-nums text-zinc-900">{when}</div>
        </div>
      ) : null}
      {appointmentScheduleHref ? (
        <Link
          href={appointmentScheduleHref}
          className="inline-block text-sm font-medium text-[#1a73e8] hover:underline"
        >
          Открыть исходный день в расписании
        </Link>
      ) : null}
    </div>
  );
}

export function ScheduleBookingRequestSafeDetailModal({
  request,
  onClose,
}: {
  request: ScheduleDayBookingRequest;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#dadce0] bg-white shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-request-safe-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#dadce0] px-4 py-3">
          <div>
            <h2
              id="booking-request-safe-detail-title"
              className="text-base font-semibold text-[#124032]"
            >
              {getScheduleBookingRequestSourceLabel(request)} ·{" "}
              {formatStudioTime(request.createdAt)}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {formatRequestDateTime(request.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            Закрыть
          </button>
        </header>

        <div className="space-y-3 px-4 py-4 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Клиент</div>
            <div className="font-medium text-zinc-900">{request.clientName}</div>
          </div>

          <div>
            <div className="text-xs text-zinc-500">Направление</div>
            <div className="text-zinc-900">
              {getScheduleBookingRequestSourceLabel(request)}
            </div>
            <div className="text-xs text-zinc-500">
              {getBookingRequestTypeLabel(request.type)}
              {"masterName" in request && request.masterName
                ? ` · ${request.masterName}`
                : ""}
            </div>
          </div>

          {request.serviceNameSnapshot ? (
            <div>
              <div className="text-xs text-zinc-500">Процедура</div>
              <div className="text-zinc-900">{request.serviceNameSnapshot}</div>
            </div>
          ) : null}

          <BookingRequestAppointmentContext request={request} />

          <div>
            <div className="text-xs text-zinc-500">Статус</div>
            <div className="text-zinc-900">
              {getBookingRequestStatusLabel(request.status)}
            </div>
          </div>
        </div>

        <footer className="flex justify-end border-t border-[#dadce0] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Готово
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ScheduleBookingRequestDetailModal({
  request,
  canEditStatus,
  onClose,
  onStatusUpdated,
}: {
  request: ScheduleDayBookingRequest;
  canEditStatus: boolean;
  onClose: () => void;
  onStatusUpdated: (request: ScheduleDayBookingRequest) => void;
}) {
  const [status, setStatus] = useState<BookingRequestStatus>(request.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isFullScheduleBookingRequest(request)) {
    return (
      <ScheduleBookingRequestSafeDetailModal request={request} onClose={onClose} />
    );
  }

  const handleStatusChange = async (nextStatus: BookingRequestStatus) => {
    setStatus(nextStatus);
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/booking/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, status: nextStatus }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        request?: ScheduleDayBookingRequest;
        error?: string;
      };

      if (!response.ok || !data.ok || !data.request) {
        throw new Error(data.error ?? "Не удалось обновить статус");
      }

      onStatusUpdated({
        ...request,
        status: data.request.status,
      });

      if (data.request.status === "CLOSED") {
        onClose();
      }
    } catch (updateError) {
      setStatus(request.status);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Не удалось обновить статус",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#dadce0] bg-white shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-request-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#dadce0] px-4 py-3">
          <div>
            <h2
              id="booking-request-detail-title"
              className="text-base font-semibold text-[#124032]"
            >
              {getScheduleBookingRequestSourceLabel(request)} ·{" "}
              {formatStudioTime(request.createdAt)}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {formatRequestDateTime(request.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            Закрыть
          </button>
        </header>

        <div className="space-y-3 px-4 py-4 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Клиент</div>
            <div className="font-medium text-zinc-900">
              {request.clientName} · {request.clientPhone}
            </div>
          </div>

          <div>
            <div className="text-xs text-zinc-500">Источник</div>
            <div className="text-zinc-900">
              {getScheduleBookingRequestSourceLabel(request)}
            </div>
            <div className="text-xs text-zinc-500">
              {getBookingRequestTypeLabel(request.type)}
              {"masterName" in request && request.masterName
                ? ` · ${request.masterName}`
                : ""}
            </div>
          </div>

          {request.serviceNameSnapshot ? (
            <div>
              <div className="text-xs text-zinc-500">Процедура</div>
              <div className="text-zinc-900">{request.serviceNameSnapshot}</div>
            </div>
          ) : null}

          <BookingRequestAppointmentContext request={request} />

          <div>
            <div className="text-xs text-zinc-500">Статус</div>
            {canEditStatus ? (
              <select
                value={status}
                disabled={saving}
                onChange={(event) =>
                  void handleStatusChange(
                    event.target.value as BookingRequestStatus,
                  )
                }
                className="mt-1 rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                <option value="NEW">Новая</option>
                <option value="CONTACTED">Связались</option>
                <option value="CLOSED">Закрыта</option>
              </select>
            ) : (
              <div className="text-zinc-900">
                {getBookingRequestStatusLabel(request.status)}
              </div>
            )}
          </div>

          {request.comment ? (
            <div>
              <div className="text-xs text-zinc-500">
                {request.type === "RESCHEDULE_REQUEST"
                  ? "Текст клиента"
                  : "Комментарий"}
              </div>
              <div className="mt-1 max-h-56 overflow-y-auto whitespace-pre-line rounded border border-[#e8eaed] bg-[#f8faf9] px-3 py-2 text-sm text-zinc-800">
                {request.comment}
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-400">Комментарий не указан.</div>
          )}

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dadce0] px-4 py-3">
          <Link
            href="/admin/booking-requests"
            className="text-sm font-medium text-[#1a73e8] hover:underline"
          >
            Открыть все заявки
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Готово
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ScheduleBookingRequestCard({
  request,
  variant = "day",
  detailLevel = "full",
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  variant?: "month" | "day";
  detailLevel?: ScheduleBookingRequestDetailLevel;
  /** When omitted, the card is informational only (no click / keyboard open). */
  onOpen?: (request: ScheduleDayBookingRequest) => void;
}) {
  if (variant === "month") {
    return (
      <ScheduleBookingRequestMonthCard
        request={request}
        detailLevel={detailLevel}
        onOpen={onOpen}
      />
    );
  }

  return (
    <ScheduleBookingRequestDayCard
      request={request}
      detailLevel={detailLevel}
      onOpen={onOpen}
    />
  );
}

function ScheduleBookingRequestMonthCard({
  request,
  detailLevel,
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  detailLevel: ScheduleBookingRequestDetailLevel;
  onOpen?: (request: ScheduleDayBookingRequest) => void;
}) {
  const shortSource = getScheduleBookingRequestShortSourceLabel(request);
  const giftLine =
    detailLevel === "full" && isFullScheduleBookingRequest(request) && request.isFromGame
      ? (() => {
          const giftName = extractGiftFromBookingComment(request.comment);
          return giftName
            ? `Подарок: ${truncateScheduleText(giftName, 22)}`
            : null;
        })()
      : null;

  const body = (
    <div className="text-[9px] leading-[1.15] text-[#124032]">
      <div className="truncate font-semibold">
        <span className="tabular-nums">{formatStudioTime(request.createdAt)}</span>
        <span className="ml-1">· {shortSource}</span>
      </div>
      <div className="truncate">{request.clientName}</div>
      {request.serviceNameSnapshot ? (
        <div className="truncate text-[#2a5648]">
          {truncateScheduleText(request.serviceNameSnapshot, 28)}
        </div>
      ) : request.type === "RESCHEDULE_REQUEST" && request.appointmentServiceName ? (
        <div className="truncate text-[#2a5648]">{request.appointmentServiceName}</div>
      ) : (
        <div className="truncate">{shortSource}</div>
      )}
      {giftLine ? (
        <div className="truncate text-[#2a5648]">{giftLine}</div>
      ) : null}
    </div>
  );

  if (!onOpen) {
    return (
      <div
        className="mb-px w-full max-h-[3.5rem] overflow-hidden rounded border border-[#b8d6c8] bg-[#edf6f1] px-1 py-0.5 text-left"
        data-testid="schedule-booking-request-card-readonly"
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(request)}
      className="mb-px w-full max-h-[3.5rem] overflow-hidden rounded border border-[#b8d6c8] bg-[#edf6f1] px-1 py-0.5 text-left hover:bg-[#e3f0ea]"
      data-testid="schedule-booking-request-card"
    >
      {body}
    </button>
  );
}

function ScheduleBookingRequestDayCard({
  request,
  detailLevel,
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  detailLevel: ScheduleBookingRequestDetailLevel;
  onOpen?: (request: ScheduleDayBookingRequest) => void;
}) {
  const sourceLabel = getScheduleBookingRequestSourceLabel(request);
  const preview =
    detailLevel === "full" && isFullScheduleBookingRequest(request)
      ? getBookingRequestCommentPreview(request.comment, 1)
      : null;
  const giftLine =
    detailLevel === "full" && isFullScheduleBookingRequest(request) && request.isFromGame
      ? (() => {
          const giftName = extractGiftFromBookingComment(request.comment);
          return giftName ? `Подарок: ${giftName}` : null;
        })()
      : null;

  const body = (
    <div className="text-xs leading-snug text-[#124032]">
      <div className="font-semibold">
        <span className="tabular-nums">{formatStudioTime(request.createdAt)}</span>
        <span className="ml-1.5">· {sourceLabel}</span>
      </div>
      <div className="mt-0.5 truncate">{request.clientName}</div>
      {request.serviceNameSnapshot ? (
        <div className="mt-0.5 truncate text-[#2a5648]">
          Процедура: {request.serviceNameSnapshot}
        </div>
      ) : request.type === "RESCHEDULE_REQUEST" && request.appointmentServiceName ? (
        <div className="mt-0.5 truncate text-[#2a5648]">
          {request.appointmentServiceName}
        </div>
      ) : (
        <div className="mt-0.5 truncate">{sourceLabel}</div>
      )}
      {giftLine ? (
        <div className="mt-0.5 truncate text-[#2a5648]">{giftLine}</div>
      ) : null}
      {!giftLine && preview ? (
        <div className="mt-0.5 line-clamp-1 text-[#2a5648]">{preview}</div>
      ) : null}
      <div className="mt-0.5 text-[10px] font-medium text-[#2a5648]">
        Статус: {getBookingRequestStatusLabel(request.status)}
      </div>
    </div>
  );

  if (!onOpen) {
    return (
      <div
        className="w-full max-h-[5.5rem] overflow-hidden border border-[#b8d6c8] border-b-[#cfe0d8] bg-[#edf6f1] px-2 py-1.5 text-left"
        data-testid="schedule-booking-request-card-readonly"
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(request)}
      className="w-full max-h-[5.5rem] overflow-hidden border border-[#b8d6c8] border-b-[#cfe0d8] bg-[#edf6f1] px-2 py-1.5 text-left hover:bg-[#e3f0ea]"
      data-testid="schedule-booking-request-card"
    >
      {body}
    </button>
  );
}
