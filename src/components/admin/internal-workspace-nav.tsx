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
  "inline-block shrink-0 whitespace-nowrap py-1 text-[#1a73e8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]";
const activeClass =
  "inline-block shrink-0 whitespace-nowrap py-1 font-medium text-zinc-900";

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

  // Schedule: одна горизонтально прокручиваемая строка на мобильных —
  // иначе OWNER-nav на wrap съедает высоту scrollport таблицы.
  // Admin: прежний wrap (страница скроллится целиком).
  const navClass =
    variant === "schedule"
      ? [
          "flex min-w-0 flex-nowrap items-center gap-x-3",
          "overflow-x-auto overscroll-x-contain",
          "[-webkit-overflow-scrolling:touch]",
          "text-xs sm:text-sm",
          "lg:flex-wrap lg:overflow-x-visible",
        ].join(" ")
      : "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm";

  return (
    <nav
      aria-label="Навигация рабочих разделов"
      className={navClass}
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
