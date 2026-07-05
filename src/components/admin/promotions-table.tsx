import type { PromotionAdminRule } from "@/services/PromotionAdminService";

function formatDate(value: string | null): string {
  if (!value?.trim()) {
    return "—";
  }
  return value.trim();
}

function StatusBadge({ status }: { status: PromotionAdminRule["status"] }) {
  if (status === "active") {
    return (
      <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">
        Активна
      </span>
    );
  }

  return (
    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Выключена
    </span>
  );
}

function KindBadge({ kind }: { kind: PromotionAdminRule["kind"] }) {
  if (kind === "GIFT") {
    return (
      <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
        Подарок
      </span>
    );
  }

  return (
    <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
      Скидка
    </span>
  );
}

export function PromotionsTable({ rules }: { rules: PromotionAdminRule[] }) {
  if (rules.length === 0) {
    return (
      <p className="rounded border border-[#dadce0] bg-white px-4 py-6 text-sm text-zinc-500">
        Правила акций пока не настроены.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[#dadce0] bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[#dadce0] bg-[#f8f9fa] text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Название</th>
            <th className="px-3 py-2 font-medium">Тип</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Условие</th>
            <th className="px-3 py-2 font-medium">Применяется к</th>
            <th className="px-3 py-2 font-medium">Значение</th>
            <th className="px-3 py-2 font-medium">Текст в расписании</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-b border-[#e8eaed] last:border-b-0">
              <td className="px-3 py-2 align-top font-medium text-zinc-900">
                {rule.name}
                {rule.source === "planned" ? (
                  <div className="mt-1 text-[10px] font-normal text-zinc-400">
                    Запланировано
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 align-top">
                <KindBadge kind={rule.kind} />
              </td>
              <td className="px-3 py-2 align-top">
                <StatusBadge status={rule.status} />
              </td>
              <td className="px-3 py-2 align-top text-zinc-700">
                {rule.conditionLabel}
              </td>
              <td className="px-3 py-2 align-top text-zinc-700">{rule.appliesTo}</td>
              <td className="px-3 py-2 align-top text-zinc-700">{rule.valueLabel}</td>
              <td className="px-3 py-2 align-top text-zinc-700">{rule.scheduleText}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-[#e8eaed] px-3 py-2 text-xs text-zinc-500">
        Период действия и текст для клиента — во внутренней карточке ниже таблицы.
      </div>
    </div>
  );
}

export function PromotionsDetailsList({ rules }: { rules: PromotionAdminRule[] }) {
  return (
    <div className="grid gap-3">
      {rules.map((rule) => (
        <article
          key={`details-${rule.id}`}
          className="rounded border border-[#dadce0] bg-white px-4 py-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-zinc-900">{rule.name}</h2>
            <KindBadge kind={rule.kind} />
            <StatusBadge status={rule.status} />
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-zinc-500">Текст для клиента</dt>
              <dd className="mt-0.5 text-zinc-800">{rule.clientText}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Текст в расписании</dt>
              <dd className="mt-0.5 text-zinc-800">{rule.scheduleText}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Дата начала</dt>
              <dd className="mt-0.5">{formatDate(rule.startDate)}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Дата окончания</dt>
              <dd className="mt-0.5">{formatDate(rule.endDate)}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Последнее изменение</dt>
              <dd className="mt-0.5">{formatDate(rule.updatedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">Источник</dt>
              <dd className="mt-0.5">
                {rule.source === "promo-engine"
                  ? "promo-engine"
                  : rule.source === "gift-engine"
                    ? "gift-engine"
                    : "planned"}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
