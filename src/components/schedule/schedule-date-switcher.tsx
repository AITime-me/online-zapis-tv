"use client";

import Link from "next/link";
import {
  addDaysToDateKey,
  formatDateKeyLabel,
} from "@/lib/datetime/date-key";

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
    <div className="flex flex-col gap-3">
      <div className="text-sm text-zinc-600">
        Дата:{" "}
        <span className="font-medium text-zinc-900">
          {formatDateKeyLabel(currentDate)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {buttons.map((button) => {
          const isActive = button.date === currentDate;
          return (
            <Link
              key={button.date}
              href={`/schedule?date=${button.date}`}
              className={`rounded px-3 py-1.5 text-sm ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
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
