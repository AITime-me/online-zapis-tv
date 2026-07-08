"use client";

import type { ScheduleDayBookingRequest, ScheduleDayManagerNote } from "@/types/schedule";
import { MANAGER_COL } from "@/components/schedule/schedule-month-table-styles";
import { ScheduleBookingRequestCard } from "@/components/schedule/schedule-booking-request-card";

export function ScheduleMonthManagerCell({
  notes,
  bookingRequests = [],
  onOpen,
  onRequestOpen,
}: {
  notes: ScheduleDayManagerNote[];
  bookingRequests?: ScheduleDayBookingRequest[];
  onOpen?: () => void;
  onRequestOpen?: (request: ScheduleDayBookingRequest) => void;
}) {
  const isEmpty = notes.length === 0 && bookingRequests.length === 0;
  const isInteractive = Boolean(onOpen);

  return (
    <td
      className={`${MANAGER_COL} border-b border-r border-[#d0d5da] px-1.5 py-0.5 align-top ${
        isInteractive ? "cursor-pointer hover:bg-[#f3f6f8]" : ""
      }`}
      onClick={onOpen}
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
      {isEmpty ? (
        <span className="text-[10px] text-zinc-400">—</span>
      ) : (
        <div className="flex flex-col gap-px">
          {notes.map((note) => (
            <div
              key={note.id}
              className="text-[10px] leading-tight text-zinc-800"
            >
              {note.content}
            </div>
          ))}
          {bookingRequests.map((request) => (
            <div
              key={request.id}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ScheduleBookingRequestCard
                request={request}
                variant="month"
                onOpen={(selected) => onRequestOpen?.(selected)}
              />
            </div>
          ))}
        </div>
      )}
    </td>
  );
}
