import type { UserRole } from "@prisma/client";
import { InternalWorkspaceNav } from "@/components/admin/internal-workspace-nav";
import type { WorkspaceNavKey } from "@/components/admin/workspace-nav-items";

type AdminNavLinksProps = {
  current?: Exclude<WorkspaceNavKey, "schedule">;
  role: UserRole;
};

export type AdminNavCurrent = AdminNavLinksProps["current"];

export function AdminNavLinks({ current, role }: AdminNavLinksProps) {
  return (
    <InternalWorkspaceNav role={role} current={current} variant="admin" />
  );
}
