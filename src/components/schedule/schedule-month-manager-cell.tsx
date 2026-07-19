"use client";

import type { ScheduleDayBookingRequest, ScheduleDayManagerNote } from "@/types/schedule";
import { MANAGER_COL } from "@/components/schedule/schedule-month-table-styles";
import { ScheduleBookingRequestCard } from "@/components/schedule/schedule-booking-request-card";

import type { ScheduleBookingRequestDetailLevel } from "@/components/schedule/schedule-booking-request-card";

export function ScheduleMonthManagerCell({
  notes,
  bookingRequests = [],
  onOpen,
  onRequestOpen,
  bookingRequestDetailLevel = "full",
}: {
  notes: ScheduleDayManagerNote[];
  bookingRequests?: ScheduleDayBookingRequest[];
  onOpen?: () => void;
  onRequestOpen?: (request: ScheduleDayBookingRequest) => void;
  bookingRequestDetailLevel?: ScheduleBookingRequestDetailLevel;
}) {
  const isEmpty = notes.length === 0 && bookingRequests.length === 0;
  const isInteractive = Boolean(onOpen);

  return (
    <td
      className={`${MANAGER_COL} relative border-b border-r border-[#d0d5da] px-1.5 py-0.5 align-top ${
        isInteractive ? "hover:bg-[#f3f6f8]" : ""
      }`}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      title={isInteractive ? "Открыть задачи менеджера" : undefined}
    >
      {isInteractive ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.();
          }}
          className="absolute right-0.5 top-0.5 z-[1] rounded bg-white/90 px-1 text-[9px] leading-none text-zinc-500 shadow-sm hover:bg-white hover:text-zinc-800"
          title="Добавить или изменить задачу"
          aria-label="Редактировать задачи менеджера"
        >
          ✎
        </button>
      ) : null}

      {isEmpty ? (
        <span
          className={`text-[10px] text-zinc-400 ${isInteractive ? "cursor-pointer" : ""}`}
          onClick={isInteractive ? onOpen : undefined}
        >
          —
        </span>
      ) : (
        <div className="flex flex-col gap-px">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`text-[10px] leading-tight text-zinc-800 ${
                isInteractive ? "cursor-pointer" : ""
              }`}
              onClick={isInteractive ? onOpen : undefined}
            >
              {note.content}
            </div>
          ))}
          {bookingRequests.map((request) => (
            <div key={request.id}>
              <ScheduleBookingRequestCard
                request={request}
                variant="month"
                detailLevel={bookingRequestDetailLevel}
                onOpen={
                  onRequestOpen
                    ? (selected) => onRequestOpen(selected)
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </td>
  );
}
