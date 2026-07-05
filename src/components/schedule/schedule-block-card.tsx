import { formatStudioTimeRange } from "@/lib/datetime/date-layer";
import type { ScheduleDayBlock } from "@/types/schedule";

export function ScheduleBlockCard({ block }: { block: ScheduleDayBlock }) {
  if (block.isFullDay) {
    return (
      <article className="border-b border-[#e8eaed] bg-[#eceff1] px-2 py-1 text-xs font-semibold uppercase leading-snug text-zinc-600 last:border-b-0">
        {block.blockTypeLabel}
      </article>
    );
  }

  const timeLabel = formatStudioTimeRange(block.startsAt, block.endsAt);

  return (
    <article className="border-b border-[#e8eaed] bg-[#f1f3f4] px-2 py-1 text-xs leading-snug last:border-b-0">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Блок
        </span>
        <span className="tabular-nums text-[10px] text-zinc-500">{timeLabel}</span>
      </div>
      <div className="text-zinc-700">{block.blockTypeLabel}</div>
    </article>
  );
}
