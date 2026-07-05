import Link from "next/link";

export type AdminNavCurrent =
  | "masters"
  | "services"
  | "export"
  | "booking-requests"
  | "promotions";

type AdminNavLinksProps = {
  current?: AdminNavCurrent;
};

const linkClass =
  "inline-block cursor-pointer py-1 text-[#1a73e8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]";
const activeClass =
  "inline-block cursor-default py-1 font-medium text-zinc-900";

type NavItem = {
  key: AdminNavCurrent | "schedule";
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: "schedule", href: "/schedule", label: "К расписанию" },
  { key: "masters", href: "/admin/masters", label: "Мастера" },
  { key: "services", href: "/admin/services", label: "Услуги" },
  { key: "promotions", href: "/admin/promotions", label: "Акции" },
  {
    key: "booking-requests",
    href: "/admin/booking-requests",
    label: "Заявки",
  },
  {
    key: "export",
    href: "/admin/emergency-export",
    label: "Аварийная выгрузка",
  },
];

export function AdminNavLinks({ current }: AdminNavLinksProps) {
  return (
    <nav
      aria-label="Навигация админки"
      className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      {NAV_ITEMS.map((item) => {
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
