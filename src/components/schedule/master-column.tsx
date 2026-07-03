import { formatStudioTimeRange } from "@/lib/datetime/date-key";
import type { ScheduleDayMaster } from "@/types/schedule";
import { AppointmentCard } from "@/components/schedule/appointment-card";
import { ScheduleBlockCard } from "@/components/schedule/schedule-block-card";

type MasterColumnItem =
  | { kind: "appointment"; sortAt: string; appointment: ScheduleDayMaster["appointments"][number] }
  | { kind: "block"; sortAt: string; block: ScheduleDayMaster["scheduleBlocks"][number] }
  | { kind: "extraWork"; sortAt: string; extraWork: NonNullable<ScheduleDayMaster["extraWorkWindows"]>[number] };

export function MasterColumn({
  master,
  className = "",
}: {
  master: ScheduleDayMaster;
  className?: string;
}) {
  const items: MasterColumnItem[] = [
    ...(master.extraWorkWindows ?? []).map((extraWork) => ({
      kind: "extraWork" as const,
      sortAt: extraWork.startsAt,
      extraWork,
    })),
    ...master.appointments.map((appointment) => ({
      kind: "appointment" as const,
      sortAt: appointment.startsAt,
      appointment,
    })),
    ...master.scheduleBlocks.map((block) => ({
      kind: "block" as const,
      sortAt: block.startsAt,
      block,
    })),
  ].sort(
    (left, right) =>
      new Date(left.sortAt).getTime() - new Date(right.sortAt).getTime(),
  );

  return (
    <section className={`flex flex-col bg-white ${className}`}>
      {items.length === 0 ? (
        <p className="px-2 py-2 text-[11px] italic text-zinc-400">
          Нет записей
        </p>
      ) : (
        items.map((item) => {
          if (item.kind === "appointment") {
            return (
              <AppointmentCard
                key={`appointment-${item.appointment.id}`}
                appointment={item.appointment}
              />
            );
          }

          if (item.kind === "block") {
            return (
              <ScheduleBlockCard
                key={`block-${item.block.id}`}
                block={item.block}
              />
            );
          }

          return (
            <div
              key={`extra-${item.extraWork.id}`}
              className="border-b border-[#e8eaed] bg-[#e8f0fe] px-2 py-1 text-xs leading-snug text-[#1a73e8] last:border-b-0"
            >
              + {formatStudioTimeRange(item.extraWork.startsAt, item.extraWork.endsAt)}
            </div>
          );
        })
      )}
    </section>
  );
}
