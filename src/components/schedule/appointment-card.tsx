import { AppointmentScheduleSummary } from "@/components/schedule/appointment-detail-summary";
import { AppointmentPromoBadges } from "@/components/schedule/appointment-promo-badges";
import {
  AppointmentMasterNoteBlock,
  AppointmentPromotionLabelBadges,
} from "@/components/schedule/appointment-master-display";
import { isScheduleAppointmentBold } from "@/lib/schedule/appointment-display";
import {
  isMasterScheduleAppointment,
  isOperationalScheduleAppointment,
} from "@/lib/schedule/appointment-contract";
import { CLIENT_RESCHEDULE_APPOINTMENT_NOTICE } from "@/lib/schedule/client-reschedule-notice";
import type { ScheduleDayAppointment } from "@/types/schedule";

export function AppointmentCard({
  appointment,
}: {
  appointment: ScheduleDayAppointment;
}) {
  const isBold = isScheduleAppointmentBold(appointment);
  const operational = isOperationalScheduleAppointment(appointment);
  const master = isMasterScheduleAppointment(appointment);
  const showRescheduleNotice = appointment.statusCode === "RESCHEDULED";

  return (
    <article
      className={`border-b border-[#e8eaed] px-2 py-1.5 text-xs leading-snug last:border-b-0 ${
        isBold ? "font-bold" : ""
      }`}
    >
      <AppointmentScheduleSummary appointment={appointment} />

      {showRescheduleNotice ? (
        <div className="mt-0.5 rounded bg-amber-50 px-1.5 py-1 text-[10px] font-semibold leading-snug text-amber-900">
          {CLIENT_RESCHEDULE_APPOINTMENT_NOTICE}
        </div>
      ) : null}

      {operational ? (
        <AppointmentPromoBadges
          promotions={appointment.appliedPromotions}
          className="mt-0.5"
        />
      ) : null}

      {master ? (
        <AppointmentPromotionLabelBadges
          labels={appointment.promotionLabels}
          className="mt-0.5"
        />
      ) : null}

      {operational && appointment.importantNote ? (
        <div className="mt-0.5">
          <AppointmentMasterNoteBlock note={appointment.importantNote} />
        </div>
      ) : null}

      {master && appointment.masterNote ? (
        <div className="mt-0.5">
          <AppointmentMasterNoteBlock note={appointment.masterNote} />
        </div>
      ) : null}

      <div className="mt-0.5 text-[10px] font-normal text-zinc-400">
        {appointment.status} · {appointment.source}
      </div>
    </article>
  );
}
