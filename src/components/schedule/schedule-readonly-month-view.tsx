"use client";

import Link from "next/link";
import { addMonthsToMonthKey, formatMonthTitle } from "@/lib/datetime/date-key";
import type { ScheduleMonthData } from "@/types/schedule-month";
import { ScheduleMonthTable } from "@/components/schedule/schedule-month-table";

export function ScheduleReadonlyMonthView({
  data,
  token,
}: {
  data: ScheduleMonthData;
  token: string;
}) {
  const prevMonth = addMonthsToMonthKey(data.month, -1);
  const nextMonth = addMonthsToMonthKey(data.month, 1);

  const buildHref = (month: string) =>
    `/view/schedule?token=${encodeURIComponent(token)}&month=${month}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Link
          href={buildHref(prevMonth)}
          className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
          aria-label="Предыдущий месяц"
        >
          ‹
        </Link>
        <span className="min-w-[120px] text-center text-xs font-medium text-zinc-900">
          {formatMonthTitle(data.month)}
        </span>
        <Link
          href={buildHref(nextMonth)}
          className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
          aria-label="Следующий месяц"
        >
          ›
        </Link>
      </div>
      <ScheduleMonthTable data={data} readOnly />
    </div>
  );
}
