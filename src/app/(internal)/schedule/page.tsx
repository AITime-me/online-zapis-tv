import { requireAuth } from "@/lib/auth/session";
import {
  canManageOperationalEntities,
} from "@/lib/auth/permissions";
import { ScheduleWorkspaceHeader } from "@/components/schedule/schedule-workspace-header";
import { ScheduleDayView } from "@/components/schedule/schedule-day-view";
import { ScheduleMonthView } from "@/components/schedule/schedule-month-view";
import { normalizeMonthKey } from "@/lib/datetime/date-layer";
import {
  getStudioTodayRange,
  isValidDateKey,
} from "@/lib/datetime/studio";
import { scheduleLoadOptionsForRole } from "@/lib/schedule/schedule-load-options";
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
  const scheduleLoadOptions = scheduleLoadOptionsForRole(user.role);
  const canManageOperational = canManageOperationalEntities(user.role);

  if (view === "day") {
    const dateKey =
      params.date && isValidDateKey(params.date)
        ? params.date
        : studioToday;
    const data = await getScheduleDayData(dateKey, scheduleLoadOptions);

    return (
      <main className="schedule-viewport-height flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f8f9fa] p-2 md:p-3">
        {pageHeader}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScheduleDayView
            data={data}
            studioToday={studioToday}
            canEditManagerNotes={canManageOperational}
            canEditRequests={canManageOperational}
            canViewFullBookingRequestDetails={canManageOperational}
          />
        </div>
      </main>
    );
  }

  const monthKey = normalizeMonthKey(params.month);
  const monthData = await getScheduleMonthData(monthKey, scheduleLoadOptions);

  return (
    <main className="schedule-viewport-height flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f8f9fa] p-2 md:p-3">
      {pageHeader}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScheduleMonthView
          data={monthData}
          userRole={user.role}
          canViewFullBookingRequestDetails={canManageOperational}
        />
      </div>
    </main>
  );
}

