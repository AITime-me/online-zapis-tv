import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/logout-button";
import { ScheduleDayView } from "@/components/schedule/schedule-day-view";
import {
  getStudioTodayRange,
  isValidDateKey,
} from "@/lib/datetime/studio";
import { getScheduleDayData } from "@/services/ScheduleDayService";

type SchedulePageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const user = await requireAuth();
  const params = await searchParams;

  const dateKey =
    params.date && isValidDateKey(params.date)
      ? params.date
      : getStudioTodayRange().dateKey;

  const studioToday = getStudioTodayRange().dateKey;
  const data = await getScheduleDayData(dateKey);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Расписание</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {user.name} · {ROLE_LABELS[user.role]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {(user.role === "OWNER" || user.role === "MANAGER") && (
            <Link
              href="/admin/emergency-export"
              className="text-sm text-zinc-600 underline"
            >
              Аварийная выгрузка
            </Link>
          )}
          <LogoutButton />
        </div>
      </header>

      <ScheduleDayView data={data} studioToday={studioToday} />
    </main>
  );
}
