"use client";

import Link from "next/link";
import {
  addMonthsToMonthKey,
  formatMonthTitle,
  normalizeMonthKey,
} from "@/lib/datetime/date-layer";

export function ScheduleViewSwitcher({
  view,
  month,
  date,
}: {
  view: "month" | "day";
  month: string;
  date?: string;
}) {
  const safeMonth = normalizeMonthKey(month);
  const prevMonth = addMonthsToMonthKey(safeMonth, -1);
  const nextMonth = addMonthsToMonthKey(safeMonth, 1);
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : `${safeMonth}-01`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-1">
        <Link
          href={`/schedule?view=month&month=${prevMonth}`}
          className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
          aria-label="Предыдущий месяц"
        >
          ‹
        </Link>
        <span className="min-w-[120px] text-center text-xs font-medium text-zinc-900">
          {formatMonthTitle(safeMonth)}
        </span>
        <Link
          href={`/schedule?view=month&month=${nextMonth}`}
          className="border border-[#dadce0] bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-[#f1f3f4]"
          aria-label="Следующий месяц"
        >
          ›
        </Link>
      </div>

      <div className="flex gap-0.5">
        <Link
          href={`/schedule?view=month&month=${safeMonth}`}
          className={`px-2 py-0.5 text-xs ${
            view === "month"
              ? "bg-[#1a73e8] font-medium text-white"
              : "border border-[#dadce0] bg-white text-zinc-700 hover:bg-[#f1f3f4]"
          }`}
        >
          Месяц
        </Link>
        <Link
          href={`/schedule?view=day&date=${safeDate}`}
          className={`px-2 py-0.5 text-xs ${
            view === "day"
              ? "bg-[#1a73e8] font-medium text-white"
              : "border border-[#dadce0] bg-white text-zinc-700 hover:bg-[#f1f3f4]"
          }`}
        >
          День
        </Link>
      </div>
    </div>
  );
}
