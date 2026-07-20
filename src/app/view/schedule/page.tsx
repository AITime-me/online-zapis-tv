import { notFound } from "next/navigation";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";
import { normalizeMonthKey } from "@/lib/datetime/date-layer";
import { ScheduleReadonlyMonthView } from "@/components/schedule/schedule-readonly-month-view";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";
import { SCHEDULE_LOAD_VIEW_ONLY } from "@/lib/schedule/schedule-load-options";

type ViewSchedulePageProps = {
  searchParams: Promise<{ token?: string; month?: string }>;
};

export default async function ViewSchedulePage({
  searchParams,
}: ViewSchedulePageProps) {
  const params = await searchParams;

  if (!isValidScheduleViewToken(params.token)) {
    notFound();
  }

  const monthKey = normalizeMonthKey(params.month);
  const monthData = await getScheduleMonthData(monthKey, SCHEDULE_LOAD_VIEW_ONLY);

  return (
    <main className="schedule-viewport-height flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f8f9fa] p-2 md:p-3">
      <header className="mb-2 shrink-0 border-b border-[#dadce0] bg-white px-2 py-1.5">
        <h1 className="text-sm font-semibold text-zinc-900">Расписание</h1>
        <p className="text-xs text-zinc-500">Только просмотр</p>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScheduleReadonlyMonthView
          data={monthData}
          token={params.token!}
        />
      </div>
    </main>
  );
}
