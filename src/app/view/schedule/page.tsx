import { notFound } from "next/navigation";
import { isValidScheduleViewToken } from "@/lib/auth/view-schedule-token";
import { isValidMonthKey } from "@/lib/datetime/date-key";
import { getStudioCurrentMonthKey } from "@/lib/datetime/studio";
import { ScheduleReadonlyMonthView } from "@/components/schedule/schedule-readonly-month-view";
import { getScheduleMonthData } from "@/services/ScheduleMonthService";

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

  const monthKey =
    params.month && isValidMonthKey(params.month)
      ? params.month
      : getStudioCurrentMonthKey();
  const monthData = await getScheduleMonthData(monthKey);

  return (
    <main className="flex min-h-screen flex-col bg-[#f8f9fa] p-2 md:p-3">
      <header className="mb-2 border-b border-[#dadce0] bg-white px-2 py-1.5">
        <h1 className="text-sm font-semibold text-zinc-900">Расписание</h1>
        <p className="text-xs text-zinc-500">Только просмотр</p>
      </header>
      <ScheduleReadonlyMonthView
        data={monthData}
        token={params.token!}
      />
    </main>
  );
}
