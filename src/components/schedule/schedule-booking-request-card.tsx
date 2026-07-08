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
  truncateScheduleText,
} from "@/lib/schedule/booking-request-schedule";
import {
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
} from "@/services/BookingRequestService";
import type { ScheduleDayBookingRequest } from "@/types/schedule";

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
              Заявка · {formatStudioTime(request.createdAt)}
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
              {request.masterName ? ` · ${request.masterName}` : ""}
            </div>
          </div>

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
              <div className="text-xs text-zinc-500">Комментарий</div>
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
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  variant?: "month" | "day";
  onOpen: (request: ScheduleDayBookingRequest) => void;
}) {
  if (variant === "month") {
    return (
      <ScheduleBookingRequestMonthCard request={request} onOpen={onOpen} />
    );
  }

  return (
    <ScheduleBookingRequestDayCard request={request} onOpen={onOpen} />
  );
}

function ScheduleBookingRequestMonthCard({
  request,
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  onOpen: (request: ScheduleDayBookingRequest) => void;
}) {
  const shortSource = getScheduleBookingRequestShortSourceLabel(request);
  const giftName = request.isFromGame
    ? extractGiftFromBookingComment(request.comment)
    : null;
  const giftLine = giftName
    ? `Подарок: ${truncateScheduleText(giftName, 22)}`
    : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(request)}
      className="mb-px w-full max-h-[3.5rem] overflow-hidden rounded border border-[#b8d6c8] bg-[#edf6f1] px-1 py-0.5 text-left hover:bg-[#e3f0ea]"
    >
      <div className="text-[9px] leading-[1.15] text-[#124032]">
        <div className="truncate font-semibold">
          <span className="tabular-nums">{formatStudioTime(request.createdAt)}</span>
          <span className="ml-1">· Заявка</span>
        </div>
        <div className="truncate">
          {request.clientName} · {request.clientPhone}
        </div>
        <div className="truncate">{shortSource}</div>
        {giftLine ? (
          <div className="truncate text-[#2a5648]">{giftLine}</div>
        ) : null}
      </div>
    </button>
  );
}

function ScheduleBookingRequestDayCard({
  request,
  onOpen,
}: {
  request: ScheduleDayBookingRequest;
  onOpen: (request: ScheduleDayBookingRequest) => void;
}) {
  const sourceLabel = getScheduleBookingRequestSourceLabel(request);
  const preview = getBookingRequestCommentPreview(request.comment, 1);
  const giftName = request.isFromGame
    ? extractGiftFromBookingComment(request.comment)
    : null;
  const giftLine = giftName ? `Подарок: ${giftName}` : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(request)}
      className="w-full max-h-[5.5rem] overflow-hidden border border-[#b8d6c8] border-b-[#cfe0d8] bg-[#edf6f1] px-2 py-1.5 text-left hover:bg-[#e3f0ea]"
    >
      <div className="text-xs leading-snug text-[#124032]">
        <div className="font-semibold">
          <span className="tabular-nums">{formatStudioTime(request.createdAt)}</span>
          <span className="ml-1.5">· Заявка</span>
        </div>
        <div className="mt-0.5 truncate">
          {request.clientName} · {request.clientPhone}
        </div>
        <div className="mt-0.5 truncate">{sourceLabel}</div>
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
    </button>
  );
}
