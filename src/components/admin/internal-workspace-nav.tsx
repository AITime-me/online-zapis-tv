import Link from "next/link";
import type { UserRole } from "@prisma/client";
import {
  canAccessAdminSection,
  canManageOperationalEntities,
} from "@/lib/auth/permissions";
import {
  WORKSPACE_NAV_ITEMS,
  type WorkspaceNavKey,
} from "@/components/admin/workspace-nav-items";

const linkClass =
  "inline-block whitespace-nowrap py-1 text-[#1a73e8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]";
const activeClass =
  "inline-block whitespace-nowrap py-1 font-medium text-zinc-900";

type InternalWorkspaceNavProps = {
  role: UserRole;
  current?: WorkspaceNavKey;
  variant?: "schedule" | "admin";
};

function isNavItemVisible(role: UserRole, section: (typeof WORKSPACE_NAV_ITEMS)[number]["section"]) {
  if (section === null) {
    return canManageOperationalEntities(role);
  }

  return canAccessAdminSection(role, section);
}

export function InternalWorkspaceNav({
  role,
  current,
  variant = "schedule",
}: InternalWorkspaceNavProps) {
  const visibleItems = WORKSPACE_NAV_ITEMS.filter((item) =>
    isNavItemVisible(role, item.section),
  );

  return (
    <nav
      aria-label="Навигация рабочих разделов"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm"
    >
      {visibleItems.map((item) => {
        const isActive = current === item.key;
        const label =
          variant === "admin" && item.adminLabel ? item.adminLabel : item.label;

        if (isActive) {
          return (
            <span key={item.key} aria-current="page" className={activeClass}>
              {label}
            </span>
          );
        }

        return (
          <Link key={item.key} href={item.href} className={linkClass}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
