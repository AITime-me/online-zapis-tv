"use client";

import { useMemo } from "react";
import type {
  ScheduleDayBookingRequest,
  ScheduleDayManagerNote,
} from "@/types/schedule";
import { formatStudioTime } from "@/lib/datetime/date-layer";
import { ScheduleBookingRequestCard } from "@/components/schedule/schedule-booking-request-card";

type ManagerTimelineItem =
  | { kind: "note"; createdAt: string; note: ScheduleDayManagerNote }
  | { kind: "request"; createdAt: string; request: ScheduleDayBookingRequest };

function compareTimelineItems(a: ManagerTimelineItem, b: ManagerTimelineItem): number {
  return a.createdAt.localeCompare(b.createdAt);
}

import type { ScheduleBookingRequestDetailLevel } from "@/components/schedule/schedule-booking-request-card";

export function ManagerColumn({
  notes,
  bookingRequests = [],
  onRequestOpen,
  bookingRequestDetailLevel = "full",
  className = "",
}: {
  notes: ScheduleDayManagerNote[];
  bookingRequests?: ScheduleDayBookingRequest[];
  onRequestOpen?: (request: ScheduleDayBookingRequest) => void;
  bookingRequestDetailLevel?: ScheduleBookingRequestDetailLevel;
  className?: string;
}) {
  const timeline = useMemo(() => {
    const items: ManagerTimelineItem[] = [
      ...notes.map((note) => ({
        kind: "note" as const,
        createdAt: note.createdAt,
        note,
      })),
      ...bookingRequests.map((request) => ({
        kind: "request" as const,
        createdAt: request.createdAt,
        request,
      })),
    ];

    return items.sort(compareTimelineItems);
  }, [bookingRequests, notes]);

  return (
    <section className={`flex flex-col bg-white ${className}`}>
      {timeline.length === 0 ? (
        <p className="px-2 py-2 text-[11px] italic text-zinc-400">
          Нет заметок и заявок
        </p>
      ) : (
        timeline.map((item) =>
          item.kind === "note" ? (
            <div
              key={`note-${item.note.id}`}
              className="border-b border-[#e8eaed] px-2 py-1 text-xs leading-snug last:border-b-0"
            >
              <span className="tabular-nums text-[10px] text-zinc-500">
                {formatStudioTime(item.note.createdAt)}
              </span>
              <span className="ml-1.5 whitespace-pre-wrap text-zinc-800">
                {item.note.content}
              </span>
            </div>
          ) : (
            <ScheduleBookingRequestCard
              key={`request-${item.request.id}`}
              request={item.request}
              variant="day"
              detailLevel={bookingRequestDetailLevel}
              onOpen={
                onRequestOpen
                  ? (request) => onRequestOpen(request)
                  : undefined
              }
            />
          ),
        )
      )}
    </section>
  );
}
