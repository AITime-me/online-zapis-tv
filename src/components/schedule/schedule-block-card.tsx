import { formatStudioTime } from "@/lib/datetime/date-key";
import type { ScheduleDayBlock } from "@/types/schedule";

export function ScheduleBlockCard({ block }: { block: ScheduleDayBlock }) {
  const timeLabel = `${formatStudioTime(new Date(block.startsAt))} – ${formatStudioTime(new Date(block.endsAt))}`;

  return (
    <article className="border-b border-[#e8eaed] bg-[#f1f3f4] px-2 py-1 text-xs leading-snug last:border-b-0">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Блок
        </span>
        <span className="tabular-nums text-[10px] text-zinc-500">{timeLabel}</span>
      </div>
      <div className="text-zinc-700">{block.blockTypeLabel}</div>
      {block.internalReason ? (
        <div className="text-[10px] text-zinc-500">{block.internalReason}</div>
      ) : null}
    </article>
  );
}
