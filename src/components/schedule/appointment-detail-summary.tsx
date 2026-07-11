import {
  buildScheduleAppointmentDisplay,
  formatScheduleClientName,
  isScheduleAppointmentBold,
} from "@/lib/schedule/appointment-display";
import { isOperationalScheduleAppointment } from "@/lib/schedule/appointment-contract";
import { formatDateKeyLabel } from "@/lib/datetime/date-layer";
import type { ScheduleDayAppointment } from "@/types/schedule";

/** Компактное отображение в сетке расписания: время, процедура, имя клиента. */
export function AppointmentScheduleSummary({
  appointment,
}: {
  appointment: ScheduleDayAppointment;
}) {
  const display = buildScheduleAppointmentDisplay(appointment);
  const isBold = isScheduleAppointmentBold(appointment);

  return (
    <div className="space-y-0.5">
      <div
        className={`tabular-nums text-zinc-900 ${
          isBold ? "font-bold" : "font-semibold"
        }`}
      >
        {display.timeLabel}
      </div>
      <div className={`text-zinc-900 ${isBold ? "font-bold" : ""}`}>
        {display.serviceTitle}
      </div>
      <div className={`text-zinc-700 ${isBold ? "font-bold" : ""}`}>
        {display.clientLabel}
      </div>
    </div>
  );
}

/** Полная карточка записи для администратора. */
export function AppointmentRecordSummary({
  appointment,
  masterName,
  dateKey,
}: {
  appointment: ScheduleDayAppointment;
  masterName?: string | null;
  dateKey?: string;
}) {
  const display = buildScheduleAppointmentDisplay(appointment);

  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-sm font-semibold tabular-nums text-zinc-900">
        {display.timeLabel}
        {dateKey ? (
          <span className="ml-2 text-xs font-normal text-zinc-600">
            {formatDateKeyLabel(dateKey)}
          </span>
        ) : null}
      </div>
      <div className="text-zinc-900">{display.serviceTitle}</div>
      {masterName ? <div className="text-zinc-700">Мастер: {masterName}</div> : null}
      <div className="text-zinc-700">Клиент: {display.clientLabel}</div>
      {isOperationalScheduleAppointment(appointment) ? (
        <>
          <div className="tabular-nums text-zinc-600">Телефон: {display.phoneLabel}</div>
          {display.comment ? (
            <div className="text-zinc-600">Комментарий: {display.comment}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Имя клиента для компактной строки месячного расписания. */
export function formatMonthAppointmentClientLine(
  appointment: Pick<ScheduleDayAppointment, "clientName">,
): string {
  return formatScheduleClientName(appointment.clientName);
}
