import type { ServiceAdminRow } from "@/types/service-admin";

const actionButtonClass =
  "rounded border border-[#1a73e8] bg-white px-2 py-1 text-xs font-medium text-[#1a73e8] hover:bg-[#e8f0fe]";

export function formatServicePrice(service: ServiceAdminRow): string {
  if (service.priceFrom != null && service.priceTo != null) {
    return `${service.priceFrom}–${service.priceTo} ₽`;
  }
  if (service.priceFrom != null) {
    return `от ${service.priceFrom} ₽`;
  }
  if (service.price != null) {
    return `${service.price} ₽`;
  }
  return "—";
}

function formatMasterNames(service: ServiceAdminRow): string {
  const enabled = service.masters.filter((link) => link.isEnabled);
  if (enabled.length === 0) {
    const disabled = service.masters.filter((link) => !link.isEnabled);
    if (disabled.length === 0) {
      return "—";
    }
    return disabled.map((link) => `${link.masterInternalName} (откл.)`).join(", ");
  }
  return enabled.map((link) => link.masterInternalName).join(", ");
}

function ServiceBadges({ service }: { service: ServiceAdminRow }) {
  const badges: { label: string; className: string }[] = [];

  if (!service.isActive) {
    badges.push({
      label: "Архив",
      className: "bg-zinc-100 text-zinc-600",
    });
  } else {
    if (!service.isPublic) {
      badges.push({
        label: "Скрыта",
        className: "bg-amber-50 text-amber-800",
      });
    }
    if (service.isOnlineBookingEnabled) {
      badges.push({
        label: "Онлайн",
        className: "bg-green-50 text-green-800",
      });
    } else {
      badges.push({
        label: "Инфо",
        className: "bg-blue-50 text-blue-800",
      });
    }
  }

  if (badges.length === 0) {
    return <span className="text-xs text-zinc-400">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

type ServicesTableProps = {
  services: ServiceAdminRow[];
  onEdit: (service: ServiceAdminRow) => void;
};

export function ServicesTable({ services, onEdit }: ServicesTableProps) {
  if (services.length === 0) {
    return (
      <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
        Услуги не найдены
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[#dadce0] bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-[#dadce0] bg-zinc-50 text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">Категория</th>
            <th className="px-3 py-2 font-medium">Название</th>
            <th className="px-3 py-2 font-medium">Мастер</th>
            <th className="px-3 py-2 font-medium">Цена</th>
            <th className="px-3 py-2 font-medium">Длит.</th>
            <th className="px-3 py-2 font-medium">Перерыв</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Видимость</th>
            <th className="px-3 py-2 font-medium">Онлайн</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#dadce0]">
          {services.map((service) => (
            <tr key={service.id} className="hover:bg-zinc-50/80">
              <td className="px-3 py-2 text-zinc-600">{service.categoryName}</td>
              <td className="px-3 py-2">
                <div className="font-medium text-zinc-900">{service.publicName}</div>
                {service.internalName !== service.publicName ? (
                  <div className="text-[10px] text-zinc-500">
                    {service.internalName}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-zinc-700">{formatMasterNames(service)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-zinc-700">
                {formatServicePrice(service)}
              </td>
              <td className="px-3 py-2 text-zinc-700">
                {service.durationMinutes} мин
              </td>
              <td className="px-3 py-2 text-zinc-700">
                {service.breakAfterMinutes > 0
                  ? `${service.breakAfterMinutes} мин`
                  : "—"}
              </td>
              <td className="px-3 py-2">
                <ServiceBadges service={service} />
              </td>
              <td className="px-3 py-2 text-zinc-700">
                {service.isPublic ? "Видна" : "Скрыта"}
              </td>
              <td className="px-3 py-2 text-zinc-700">
                {service.isOnlineBookingEnabled ? "Вкл." : "Выкл."}
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onEdit(service)}
                  className={actionButtonClass}
                >
                  Редактировать
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
