import type { ScheduleDayData } from "@/types/schedule";
import { ManagerColumn } from "@/components/schedule/manager-column";
import { MasterColumn } from "@/components/schedule/master-column";
import { ScheduleDateSwitcher } from "@/components/schedule/schedule-date-switcher";

export function ScheduleDayView({
  data,
  studioToday,
}: {
  data: ScheduleDayData;
  studioToday: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ScheduleDateSwitcher
        currentDate={data.date}
        studioToday={studioToday}
      />

      <div className="overflow-x-auto pb-4">
        <div className="flex min-w-max gap-4">
          <ManagerColumn notes={data.managerNotes} />
          {data.masters.map((master) => (
            <MasterColumn key={master.id} master={master} />
          ))}
        </div>
      </div>
    </div>
  );
}
