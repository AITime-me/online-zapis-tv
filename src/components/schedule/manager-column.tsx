import type { ScheduleDayManagerNote } from "@/types/schedule";
import { formatStudioTime } from "@/lib/datetime/date-key";

export function ManagerColumn({
  notes,
}: {
  notes: ScheduleDayManagerNote[];
}) {
  return (
    <section className="flex w-72 shrink-0 flex-col gap-3">
      <header className="sticky top-0 z-10 rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
        Менеджер
      </header>

      <div className="flex flex-col gap-3">
        {notes.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
            Нет заметок
          </p>
        ) : (
          notes.map((note) => (
            <article
              key={note.id}
              className="rounded border border-zinc-200 bg-white p-3 text-sm shadow-sm"
            >
              <div className="text-xs text-zinc-500">
                {formatStudioTime(new Date(note.createdAt))}
              </div>
              <div className="mt-2 whitespace-pre-wrap">{note.content}</div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
