import { AppointmentScheduleSummary } from "@/components/schedule/appointment-detail-summary";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
import { isScheduleAppointmentBold } from "@/lib/schedule/appointment-display";
import type { ScheduleDayAppointment } from "@/types/schedule";

export function AppointmentCard({
  appointment,
}: {
  appointment: ScheduleDayAppointment;
}) {
  const isBold = isScheduleAppointmentBold(appointment);

  return (
    <article
      className={`border-b border-[#e8eaed] px-2 py-1.5 text-xs leading-snug last:border-b-0 ${
        isBold ? "font-bold" : ""
      }`}
    >
      <AppointmentScheduleSummary appointment={appointment} />

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
