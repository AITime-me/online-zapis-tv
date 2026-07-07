import Link from "next/link";
import type { UserRole } from "@prisma/client";
import {
  canAccessAdminSection,
  type AdminSection,
} from "@/lib/auth/permissions";

export type AdminNavCurrent =
  | "masters"
  | "services"
  | "export"
  | "booking-requests"
  | "promotions"
  | "game"
  | "users"
  | "settings";

type AdminNavLinksProps = {
  current?: AdminNavCurrent;
  role: UserRole;
};

const linkClass =
  "inline-block cursor-pointer py-1 text-[#1a73e8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]";
const activeClass =
  "inline-block cursor-default py-1 font-medium text-zinc-900";

type NavItem = {
  key: AdminNavCurrent | "schedule";
  section: AdminSection | null;
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: "schedule", section: null, href: "/schedule", label: "К расписанию" },
  {
    key: "masters",
    section: "masters",
    href: "/admin/masters",
    label: "Мастера",
  },
  {
    key: "services",
    section: "services",
    href: "/admin/services",
    label: "Услуги",
  },
  {
    key: "booking-requests",
    section: "booking-requests",
    href: "/admin/booking-requests",
    label: "Заявки",
  },
  {
    key: "promotions",
    section: "promotions",
    href: "/admin/promotions",
    label: "Акции",
  },
  {
    key: "game",
    section: "game",
    href: "/admin/game",
    label: "Игра",
  },
  {
    key: "users",
    section: "users",
    href: "/admin/users",
    label: "Пользователи",
  },
  {
    key: "settings",
    section: "system-settings",
    href: "/admin/settings",
    label: "Настройки",
  },
  {
    key: "export",
    section: "emergency-export",
    href: "/admin/emergency-export",
    label: "Аварийная выгрузка",
  },
];

export function AdminNavLinks({ current, role }: AdminNavLinksProps) {
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.section) {
      return true;
    }

    return canAccessAdminSection(role, item.section);
  });

  return (
    <nav
      aria-label="Навигация админки"
      className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      {visibleItems.map((item) => {
        const isActive = item.key !== "schedule" && current === item.key;

        if (isActive) {
          return (
            <span key={item.href} aria-current="page" className={activeClass}>
              {item.label}
            </span>
          );
        }

        return (
          <Link key={item.href} href={item.href} className={linkClass}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
