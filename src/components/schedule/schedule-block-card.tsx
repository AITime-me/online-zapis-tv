import { formatStudioTime } from "@/lib/datetime/date-key";
import type { ScheduleDayBlock } from "@/types/schedule";

export function ScheduleBlockCard({ block }: { block: ScheduleDayBlock }) {
  const timeLabel = `${formatStudioTime(new Date(block.startsAt))} – ${formatStudioTime(new Date(block.endsAt))}`;

  return (
    <article className="rounded border border-zinc-400 bg-zinc-100 p-3 text-sm text-zinc-800">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-600">
        Блок
      </div>
      <div className="mt-1 text-xs text-zinc-600">{timeLabel}</div>
      <div className="mt-1 font-medium">{block.blockTypeLabel}</div>
      {block.internalReason ? (
        <div className="mt-2 text-xs text-zinc-700">{block.internalReason}</div>
      ) : null}
    </article>
  );
}
