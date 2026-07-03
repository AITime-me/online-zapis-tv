import { formatStudioTime } from "@/lib/datetime/date-key";
import type { ScheduleDayAppointment } from "@/types/schedule";

export function AppointmentCard({
  appointment,
}: {
  appointment: ScheduleDayAppointment;
}) {
  const timeLabel = `${formatStudioTime(new Date(appointment.startsAt))} – ${formatStudioTime(new Date(appointment.endsAt))}`;

  return (
    <article
      className={`border-b border-[#e8eaed] px-2 py-1 text-xs leading-snug last:border-b-0 ${
        appointment.isBold ? "font-bold" : ""
      }`}
    >
      <div className="tabular-nums text-[10px] font-normal text-zinc-500">
        {timeLabel}
      </div>

      <div className="text-zinc-900">
        {appointment.clientName}
        {appointment.serviceName ? (
          <span className="font-normal text-zinc-600">
            {" "}
            · {appointment.serviceName}
          </span>
        ) : null}
      </div>

      {appointment.importantNote ? (
        <div className="mt-0.5 bg-amber-50 px-1 py-px text-[10px] leading-tight text-amber-900">
          ⚠ {appointment.importantNote}
        </div>
      ) : null}

      {appointment.comment ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] font-normal text-zinc-500">
          {appointment.comment}
        </div>
      ) : null}

      <div className="mt-0.5 text-[10px] font-normal text-zinc-400">
        {appointment.status} · {appointment.source}
      </div>
    </article>
  );
}
