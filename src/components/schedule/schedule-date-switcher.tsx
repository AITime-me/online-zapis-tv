"use client";

import Link from "next/link";
import {
  addDaysToDateKey,
  formatDateKeyLabel,
} from "@/lib/datetime/date-layer";

export function ScheduleDateSwitcher({
  currentDate,
  studioToday,
}: {
  currentDate: string;
  studioToday: string;
}) {
  const buttons = [
    { label: "Сегодня", date: studioToday },
    { label: "Завтра", date: addDaysToDateKey(studioToday, 1) },
    { label: "Послезавтра", date: addDaysToDateKey(studioToday, 2) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-xs text-zinc-600">
        {formatDateKeyLabel(currentDate)}
      </span>

      <div className="flex gap-0.5">
        {buttons.map((button) => {
          const isActive = button.date === currentDate;
          return (
            <Link
              key={button.date}
              href={`/schedule?view=day&date=${button.date}`}
              className={`px-2 py-0.5 text-xs leading-tight ${
                isActive
                  ? "bg-[#1a73e8] font-medium text-white"
                  : "border border-[#dadce0] bg-white text-zinc-700 hover:bg-[#f1f3f4]"
              }`}
            >
              {button.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
