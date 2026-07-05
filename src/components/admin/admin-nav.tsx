import Link from "next/link";

type AdminNavLinksProps = {
  current?: "masters" | "services" | "export" | "booking-requests";
};

const linkClass = "text-[#1a73e8] hover:underline";
const activeClass = "font-medium text-zinc-900";

export function AdminNavLinks({ current }: AdminNavLinksProps) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      <Link href="/schedule" className={linkClass}>
        К расписанию
      </Link>
      <Link
        href="/admin/masters"
        className={current === "masters" ? activeClass : linkClass}
      >
        Мастера
      </Link>
      <Link
        href="/admin/services"
        className={current === "services" ? activeClass : linkClass}
      >
        Услуги
      </Link>
      <Link
        href="/admin/booking-requests"
        className={current === "booking-requests" ? activeClass : linkClass}
      >
        Заявки
      </Link>
      <Link
        href="/admin/emergency-export"
        className={current === "export" ? activeClass : linkClass}
      >
        Аварийная выгрузка
      </Link>
    </div>
  );
}
