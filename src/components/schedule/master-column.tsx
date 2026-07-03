import type { ScheduleDayMaster } from "@/types/schedule";
import { AppointmentCard } from "@/components/schedule/appointment-card";
import { ScheduleBlockCard } from "@/components/schedule/schedule-block-card";

type MasterColumnItem =
  | { kind: "appointment"; sortAt: string; appointment: ScheduleDayMaster["appointments"][number] }
  | { kind: "block"; sortAt: string; block: ScheduleDayMaster["scheduleBlocks"][number] };

export function MasterColumn({ master }: { master: ScheduleDayMaster }) {
  const items: MasterColumnItem[] = [
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
    <section className="flex w-72 shrink-0 flex-col gap-3">
      <header className="sticky top-0 z-10 rounded bg-zinc-800 px-3 py-2 text-sm font-medium text-white">
        <div>{master.publicName}</div>
        <div className="text-xs font-normal text-zinc-300">
          {master.internalName}
        </div>
      </header>

      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
            Нет записей
          </p>
        ) : (
          items.map((item) =>
            item.kind === "appointment" ? (
              <AppointmentCard
                key={`appointment-${item.appointment.id}`}
                appointment={item.appointment}
              />
            ) : (
              <ScheduleBlockCard
                key={`block-${item.block.id}`}
                block={item.block}
              />
            ),
          )
        )}
      </div>
    </section>
  );
}
