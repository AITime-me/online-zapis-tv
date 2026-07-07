import type { UserRole } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/auth/logout-button";
import { InternalWorkspaceNav } from "@/components/admin/internal-workspace-nav";

type ScheduleWorkspaceHeaderProps = {
  user: {
    name?: string | null;
    role: UserRole;
  };
};

export function ScheduleWorkspaceHeader({ user }: ScheduleWorkspaceHeaderProps) {
  return (
    <header className="mb-2 shrink-0 border-b border-[#dadce0] bg-white px-2 py-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-sm font-semibold text-zinc-900">Расписание</h1>
          <span className="truncate text-xs text-zinc-500">
            {user.name} · {ROLE_LABELS[user.role]}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <InternalWorkspaceNav role={user.role} current="schedule" variant="schedule" />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
