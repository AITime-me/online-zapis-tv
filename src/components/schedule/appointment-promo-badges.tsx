import { formatSchedulePromoBadgeLabel } from "@/lib/schedule/appointment-display";
import type { AppliedPromotionRecord } from "@/types/applied-promotion";

export function AppointmentPromoBadges({
  promotions,
  className = "",
}: {
  promotions: AppliedPromotionRecord[];
  className?: string;
}) {
  if (promotions.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-0.5 ${className}`.trim()}>
      {promotions.map((promotion, index) => (
        <span
          key={`${promotion.type}-${index}`}
          className="inline-block rounded bg-emerald-50 px-1 py-px text-[9px] leading-tight text-emerald-900"
          title={promotion.type}
        >
          {formatSchedulePromoBadgeLabel(promotion.label)}
        </span>
      ))}
    </div>
  );
}
