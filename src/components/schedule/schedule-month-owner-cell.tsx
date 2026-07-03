"use client";

import type { ScheduleDayManagerNote } from "@/types/schedule";

const PREVIEW_LIMIT = 3;

export function ScheduleMonthOwnerCell({
  notes,
  onOpen,
}: {
  notes: ScheduleDayManagerNote[];
  onOpen: () => void;
}) {
  const isEmpty = notes.length === 0;
  const preview = notes.slice(0, PREVIEW_LIMIT);
  const restCount = notes.length - preview.length;

  return (
    <td
      className="cursor-pointer border-r border-[#d0d5da] px-1.5 py-0.5 align-top hover:bg-[#f3f6f8]"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title="Открыть заметки руководителя"
    >
      {isEmpty ? (
        <span className="text-[10px] text-zinc-400">—</span>
      ) : (
        <div className="flex flex-col gap-px">
          {preview.map((note) => (
            <div
              key={note.id}
              className="text-[10px] leading-tight text-zinc-800"
            >
              {note.content}
            </div>
          ))}
          {restCount > 0 ? (
            <div className="text-[9px] leading-tight text-zinc-500">
              ещё {restCount}
            </div>
          ) : null}
        </div>
      )}
    </td>
  );
}
