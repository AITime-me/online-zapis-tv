"use client";

import type { ScheduleDayManagerNote } from "@/types/schedule";

export function ScheduleMonthManagerCell({
  notes,
  onOpen,
}: {
  notes: ScheduleDayManagerNote[];
  onOpen?: () => void;
}) {
  const isEmpty = notes.length === 0;
  const isInteractive = Boolean(onOpen);

  return (
    <td
      className={`border-b border-r border-[#d0d5da] px-1.5 py-0.5 align-top ${
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
        </div>
      )}
    </td>
  );
}
