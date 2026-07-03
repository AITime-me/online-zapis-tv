import type { ScheduleDayData } from "@/types/schedule";
import { ManagerColumn } from "@/components/schedule/manager-column";
import { MasterColumn } from "@/components/schedule/master-column";
import { ScheduleDateSwitcher } from "@/components/schedule/schedule-date-switcher";
import { ScheduleViewSwitcher } from "@/components/schedule/schedule-view-switcher";

const COLUMN_CLASS = "w-[280px] shrink-0 border-r border-[#dadce0] last:border-r-0";

export function ScheduleDayView({
  data,
  studioToday,
}: {
  data: ScheduleDayData;
  studioToday: string;
}) {
  const month = data.date.slice(0, 7);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ScheduleViewSwitcher view="day" month={month} date={data.date} />
        <ScheduleDateSwitcher
          currentDate={data.date}
          studioToday={studioToday}
        />
      </div>

      <div className="overflow-x-auto border border-[#dadce0] bg-white">
        <div className="min-w-max">
          <div className="flex border-b border-[#dadce0] bg-[#f8f9fa]">
            <div
              className={`${COLUMN_CLASS} px-2 py-1.5 text-xs font-semibold text-zinc-800`}
            >
              Менеджер / задачи
            </div>
            {data.masters.map((master) => (
              <div key={master.id} className={`${COLUMN_CLASS} px-2 py-1.5`}>
                <div className="text-xs font-semibold leading-tight text-zinc-900">
                  {master.internalName}
                </div>
                <div className="text-[10px] leading-tight text-zinc-500">
                  {master.publicName}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-stretch">
            <ManagerColumn notes={data.managerNotes} className={COLUMN_CLASS} />
            {data.masters.map((master) => (
              <MasterColumn
                key={master.id}
                master={master}
                className={COLUMN_CLASS}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
