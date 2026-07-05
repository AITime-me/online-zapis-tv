import { formatStudioTime } from "@/lib/datetime/date-layer";
import { getScheduleAppointmentTitle } from "@/lib/schedule/appointment-display";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
import type { ScheduleDayAppointment } from "@/types/schedule";

export function AppointmentCard({
  appointment,
}: {
  appointment: ScheduleDayAppointment;
}) {
  const timeLabel = `${formatStudioTime(appointment.startsAt)} – ${formatStudioTime(appointment.endsAt)}`;
  const title = getScheduleAppointmentTitle(appointment.serviceName);

  return (
    <article
      className={`border-b border-[#e8eaed] px-2 py-1 text-xs leading-snug last:border-b-0 ${
        appointment.isBold ? "font-bold" : ""
      }`}
    >
      <div className="text-zinc-900">{title}</div>

      <div className="tabular-nums text-[10px] font-normal text-zinc-500">
        {timeLabel}
      </div>

      <AppointmentPromoBadges
        promotions={appointment.appliedPromotions}
        className="mt-0.5"
      />

      {appointment.importantNote ? (
        <div className="mt-0.5 bg-amber-50 px-1 py-px text-[10px] leading-tight text-amber-900">
          ⚠ {appointment.importantNote}
        </div>
      ) : null}

      <div className="mt-0.5 text-[10px] font-normal text-zinc-400">
        {appointment.status} · {appointment.source}
      </div>
    </article>
  );
}
