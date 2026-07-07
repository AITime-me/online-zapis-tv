import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import {
  canAccessEmergencyExport,
  canManageBookingRequests,
  canManageMasters,
  canManageServices,
  ROLE_LABELS,
} from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/logout-button";
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

  const pageHeader = (
    <header className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#dadce0] bg-white px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <h1 className="text-sm font-semibold text-zinc-900">Расписание</h1>
        <span className="text-xs text-zinc-500">
          {user.name} · {ROLE_LABELS[user.role]}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {canManageMasters(user.role) && (
          <Link
            href="/admin/masters"
            className="text-xs text-[#1a73e8] hover:underline"
          >
            Мастера
          </Link>
        )}
        {canManageServices(user.role) && (
          <Link
            href="/admin/services"
            className="text-xs text-[#1a73e8] hover:underline"
          >
            Услуги
          </Link>
        )}
        {canManageBookingRequests(user.role) && (
          <Link
            href="/admin/booking-requests"
            className="text-xs text-[#1a73e8] hover:underline"
          >
            Заявки
          </Link>
        )}
        {canAccessEmergencyExport(user.role) && (
          <Link
            href="/admin/emergency-export"
            className="text-xs text-[#1a73e8] hover:underline"
          >
            Аварийная выгрузка
          </Link>
        )}
        <LogoutButton />
      </div>
    </header>
  );

  if (view === "day") {
    const dateKey =
      params.date && isValidDateKey(params.date)
        ? params.date
        : studioToday;
    const data = await getScheduleDayData(dateKey);

    return (
      <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#f8f9fa] p-2 md:p-3">
        {pageHeader}
        <ScheduleDayView data={data} studioToday={studioToday} />
      </main>
    );
  }

  const monthKey = normalizeMonthKey(params.month);
  const monthData = await getScheduleMonthData(monthKey);

  return (
    <main className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#f8f9fa] p-2 md:p-3">
      {pageHeader}
      <ScheduleMonthView data={monthData} userRole={user.role} />
    </main>
  );
}
