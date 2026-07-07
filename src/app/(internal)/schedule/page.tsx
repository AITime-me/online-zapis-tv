import { requireAuth } from "@/lib/auth/session";
import { ScheduleWorkspaceHeader } from "@/components/schedule/schedule-workspace-header";
import { ScheduleDayView } from "@/components/schedule/schedule-day-view";
import { ScheduleMonthView } from "@/components/schedule/schedule-month-view";
import { normalizeMonthKey } from "@/lib/datetime/date-layer";
import {
  getStudioTodayRange,
  isValidDateKey,
} from "@/lib/datetime/studio";
import { getScheduleDayData } from "@/services/ScheduleDayService";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

type SchedulePageProps = {
  searchParams: Promise<{ view?: string; month?: string; date?: string }>;
};

export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const user = await requireAuth();
  const params = await searchParams;
  const studioToday = getStudioTodayRange().dateKey;
  const view =
    params.view === "day" ||
    (params.date && isValidDateKey(params.date) && params.view !== "month")
      ? "day"
      : "month";

  const pageHeader = <ScheduleWorkspaceHeader user={user} />;

  if (view === "day") {
    const dateKey =
      params.date && isValidDateKey(params.date)
        ? params.date
        : studioToday;
    const data = await getScheduleDayData(dateKey);

    return (
      <main className="flex min-h-screen min-w-0 flex-col bg-[#f8f9fa] p-2 md:p-3">
        {pageHeader}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <ScheduleDayView data={data} studioToday={studioToday} />
        </div>
      </main>
    );
  }

  const monthKey = normalizeMonthKey(params.month);
  const monthData = await getScheduleMonthData(monthKey);

  return (
    <main className="flex min-h-screen min-w-0 flex-col bg-[#f8f9fa] p-2 md:p-3">
      {pageHeader}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <ScheduleMonthView data={monthData} userRole={user.role} />
      </div>
    </main>
  );
}
