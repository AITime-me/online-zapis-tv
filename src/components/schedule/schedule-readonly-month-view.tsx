"use client";

import Link from "next/link";
import { useCallback } from "react";
import { addMonthsToMonthKey, formatMonthTitle } from "@/lib/datetime/date-layer";
import {
  fetchViewScheduleMonth,
  useScheduleMonthAutoRefresh,
} from "@/hooks/use-schedule-month-auto-refresh";
import { useScheduleZoom } from "@/hooks/use-schedule-zoom";
import type { ScheduleMonthData } from "@/types/schedule-month";
import { ScheduleMonthTable } from "@/components/schedule/schedule-month-table";
import { ScheduleZoomControls } from "@/components/schedule/schedule-zoom-controls";

export function ScheduleReadonlyMonthView({
  data: initialData,
  token,
}: {
  data: ScheduleMonthData;
  token: string;
}) {
  const fetchMonth = useCallback(
    (month: string) => fetchViewScheduleMonth(month, token),
    [token],
  );

  const { monthData, scheduleRevision } = useScheduleMonthAutoRefresh({
    initialData,
    fetchMonth,
    pollingEnabled: true,
    debugLog: false,
  });

  const { zoom, zoomIn, zoomOut, resetZoom, scrollRef } = useScheduleZoom();

  const prevMonth = addMonthsToMonthKey(monthData.month, -1);
  const nextMonth = addMonthsToMonthKey(monthData.month, 1);

  const buildHref = (month: string) =>
    `/view/schedule?token=${encodeURIComponent(token)}&month=${month}`;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      data-testid="schedule-readonly-month-view"
      data-revision={scheduleRevision}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={buildHref(prevMonth)}
            className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
            aria-label="Предыдущий месяц"
          >
            ‹
          </Link>
          <span className="min-w-[120px] text-center text-xs font-medium text-zinc-900">
            {formatMonthTitle(monthData.month)}
          </span>
          <Link
            href={buildHref(nextMonth)}
            className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
            aria-label="Следующий месяц"
          >
            ›
          </Link>
        </div>
        <ScheduleZoomControls
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetZoom}
        />
      </div>
      <ScheduleMonthTable
        data={monthData}
        readOnly
        showManagerColumn
        canEditManagerNotes={false}
        bookingRequestDetailLevel="sanitized"
        contentZoom={zoom}
        scrollRef={scrollRef}
      />
    </div>
  );
}
