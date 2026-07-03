import type { ScheduleDayManagerNote } from "@/types/schedule";
import { formatStudioTime } from "@/lib/datetime/date-key";

export function ManagerColumn({
  notes,
  className = "",
}: {
  notes: ScheduleDayManagerNote[];
  className?: string;
}) {
  return (
    <section className={`flex flex-col bg-white ${className}`}>
      {notes.length === 0 ? (
        <p className="px-2 py-2 text-[11px] italic text-zinc-400">
          Нет заметок
        </p>
      ) : (
        notes.map((note) => (
          <div
            key={note.id}
            className="border-b border-[#e8eaed] px-2 py-1 text-xs leading-snug last:border-b-0"
          >
            <span className="tabular-nums text-[10px] text-zinc-500">
              {formatStudioTime(new Date(note.createdAt))}
            </span>
            <span className="ml-1.5 whitespace-pre-wrap text-zinc-800">
              {note.content}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
