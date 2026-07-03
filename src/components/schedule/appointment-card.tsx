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
      className={`rounded border border-zinc-200 bg-white p-3 text-sm shadow-sm ${
        appointment.isBold ? "font-semibold" : ""
      }`}
    >
      <div className="text-xs text-zinc-500">{timeLabel}</div>
      <div className="mt-1">{appointment.clientName}</div>
      {appointment.serviceName ? (
        <div className="mt-1 text-zinc-700">{appointment.serviceName}</div>
      ) : null}
      {appointment.importantNote ? (
        <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          ⚠ {appointment.importantNote}
        </div>
      ) : null}
      {appointment.comment ? (
        <div className="mt-2 text-xs text-zinc-600 line-clamp-2">
          {appointment.comment}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span>{appointment.status}</span>
        <span>•</span>
        <span>{appointment.source}</span>
      </div>
    </article>
  );
}
