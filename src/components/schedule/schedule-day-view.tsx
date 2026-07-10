"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleDayData } from "@/types/schedule";
import type { QuickManagerEditorData } from "@/types/schedule-month";
import { SCHEDULE_AUTO_REFRESH_INTERVAL_MS } from "@/hooks/use-schedule-month-auto-refresh";
import { ManagerColumn } from "@/components/schedule/manager-column";
import { MasterColumn } from "@/components/schedule/master-column";
import { QuickManagerEditor } from "@/components/schedule/quick-manager-editor";
import { ScheduleDateSwitcher } from "@/components/schedule/schedule-date-switcher";
import { ScheduleViewSwitcher } from "@/components/schedule/schedule-view-switcher";
import { SCHEDULE_TABLE_SCROLL } from "@/components/schedule/schedule-month-table-styles";
import {
  ScheduleBookingRequestDetailModal,
  ScheduleBookingRequestSafeDetailModal,
} from "@/components/schedule/schedule-booking-request-card";
import type { ScheduleDayBookingRequest } from "@/types/schedule";

const COLUMN_CLASS = "w-[280px] min-w-[280px] max-w-[280px] shrink-0 border-r border-[#dadce0] last:border-r-0";
const STICKY_MANAGER_HEADER = [
  "sticky left-0 z-[3]",
  "bg-[#f8f9fa]",
  "shadow-[2px_0_6px_-2px_rgba(0,0,0,0.12)]",
].join(" ");
const STICKY_MANAGER_BODY = [
  "sticky left-0 z-[2]",
  "bg-white",
  "shadow-[2px_0_6px_-2px_rgba(0,0,0,0.12)]",
].join(" ");

async function fetchScheduleDay(dateKey: string): Promise<ScheduleDayData | null> {
  const response = await fetch(
    `/api/schedule/day?date=${encodeURIComponent(dateKey)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as ScheduleDayData & { ok?: boolean };
  if (!response.ok || payload.ok === false) {
    return null;
  }

  return {
    date: payload.date,
    managerNotes: payload.managerNotes ?? [],
    bookingRequests: payload.bookingRequests ?? [],
    masters: payload.masters ?? [],
  };
}

export function ScheduleDayView({
  data: initialData,
  studioToday,
  canEditRequests = false,
  canEditManagerNotes = false,
  canViewFullBookingRequestDetails = true,
}: {
  data: ScheduleDayData;
  studioToday: string;
  canEditRequests?: boolean;
  canEditManagerNotes?: boolean;
  canViewFullBookingRequestDetails?: boolean;
}) {
  const [data, setData] = useState(initialData);
  const [selectedRequest, setSelectedRequest] =
    useState<ScheduleDayBookingRequest | null>(null);
  const [managerEditorData, setManagerEditorData] =
    useState<QuickManagerEditorData | null>(null);
  const dateKeyRef = useRef(initialData.date);

  useEffect(() => {
    setData(initialData);
    dateKeyRef.current = initialData.date;
  }, [initialData]);

  const refreshDay = useCallback(async () => {
    const next = await fetchScheduleDay(dateKeyRef.current);
    if (next) {
      setData(next);
    }
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshDay();
    }, SCHEDULE_AUTO_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshDay();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshDay]);

  const bookingRequestDetailLevel = canViewFullBookingRequestDetails
    ? "full"
    : "sanitized";

  const month = data.date.slice(0, 7);

  const handleStatusUpdated = (updated: ScheduleDayBookingRequest) => {
    if (updated.status === "CLOSED") {
      setData((current) => ({
        ...current,
        bookingRequests: current.bookingRequests.filter(
          (request) => request.id !== updated.id,
        ),
      }));
      setSelectedRequest(null);
      return;
    }

    setData((current) => ({
      ...current,
      bookingRequests: current.bookingRequests.map((request) =>
        request.id === updated.id ? updated : request,
      ),
    }));
    setSelectedRequest(updated);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScheduleViewSwitcher view="day" month={month} date={data.date} />
        <ScheduleDateSwitcher
          currentDate={data.date}
          studioToday={studioToday}
        />
      </div>

      <div className={`${SCHEDULE_TABLE_SCROLL} border border-[#dadce0] bg-white`}>
        <div className="w-max">
          <div className="flex w-max border-b border-[#dadce0] bg-[#f8f9fa]">
            <div
              className={`${COLUMN_CLASS} ${STICKY_MANAGER_HEADER} flex items-center justify-between gap-1 px-2 py-1.5 text-xs font-semibold text-zinc-800`}
            >
              <span>Менеджер / задачи</span>
              {canEditManagerNotes ? (
                <button
                  type="button"
                  onClick={() =>
                    setManagerEditorData({
                      dateKey: data.date,
                      notes: data.managerNotes,
                      bookingRequests: data.bookingRequests,
                    })
                  }
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Задачи
                </button>
              ) : null}
            </div>
            {data.masters.map((master) => (
              <div key={master.id} className={`${COLUMN_CLASS} px-2 py-1.5`}>
                <div className="text-xs font-semibold leading-tight text-zinc-900">
                  {master.internalName}
                </div>
                <div className="text-[10px] leading-tight text-zinc-500">
                  {master.publicName}
                </div>
              </div>
            ))}
          </div>

          <div className="flex w-max items-stretch">
            <ManagerColumn
              notes={data.managerNotes}
              bookingRequests={data.bookingRequests}
              onRequestOpen={setSelectedRequest}
              bookingRequestDetailLevel={bookingRequestDetailLevel}
              className={`${COLUMN_CLASS} ${STICKY_MANAGER_BODY}`}
            />
            {data.masters.map((master) => (
              <MasterColumn
                key={master.id}
                master={master}
                className={COLUMN_CLASS}
              />
            ))}
          </div>
        </div>
      </div>

      {managerEditorData ? (
        <QuickManagerEditor
          data={managerEditorData}
          canEdit={canEditManagerNotes}
          bookingRequestDetailLevel={bookingRequestDetailLevel}
          onClose={() => setManagerEditorData(null)}
          onRequestOpen={(request) => {
            setManagerEditorData(null);
            setSelectedRequest(request);
          }}
        />
      ) : null}

      {selectedRequest ? (
        canViewFullBookingRequestDetails ? (
          <ScheduleBookingRequestDetailModal
            request={selectedRequest}
            canEditStatus={canEditRequests}
            onClose={() => setSelectedRequest(null)}
            onStatusUpdated={handleStatusUpdated}
          />
        ) : (
          <ScheduleBookingRequestSafeDetailModal
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
          />
        )
      ) : null}
    </div>
  );
}
