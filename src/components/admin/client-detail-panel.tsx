import type { ReactNode } from "react";
import Link from "next/link";
import { getClientStatusLabel } from "@/lib/clients/defaults";
import { getEditorAppointmentStatusLabel } from "@/lib/schedule/editor-field-labels";
import {
  getBookingRequestStatusLabel,
} from "@/services/BookingRequestService";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import type { ClientDetailResult } from "@/types/client-detail";
import type { BookingRequestType } from "@prisma/client";

const REQUEST_TYPE_LABELS: Record<BookingRequestType, string> = {
  MANAGER_REQUEST: "Заявка через менеджера",
  CONSULTATION_REQUEST: "Консультация",
};

const REQUEST_SOURCE_LABELS = {
  ONLINE: "Онлайн",
} as const;

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${formatter.format(new Date(startsAt))}–${formatter.format(new Date(endsAt))}`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-900">{value}</p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ClientDetailPanel({ details }: { details: ClientDetailResult }) {
  const { client, summary } = details;

  return (
    <div className="flex flex-col gap-6">
      {client.mergedIntoClientId ? (
        <div className="rounded border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <p className="font-medium">Эта карточка объединена в другого клиента</p>
          <p className="mt-1 text-violet-800">
            Данные сохранены для просмотра. Основной клиент:{" "}
            <Link
              href={`/admin/clients/${client.mergedIntoClientId}`}
              className="font-medium text-[#1a73e8] hover:underline"
            >
              {client.mergedIntoClientName ?? "Открыть основного клиента"}
            </Link>
          </p>
        </div>
      ) : null}

      <section className="rounded border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-zinc-900">{client.fullName}</h1>
              <span className="inline-flex rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                {getClientStatusLabel(client.status)}
              </span>
              {client.isArchived ? (
                <span className="inline-flex rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  Архив
                </span>
              ) : (
                <span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Активный
                </span>
              )}
              {client.mergedIntoClientId ? (
                <span className="inline-flex rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900">
                  Объединён
                </span>
              ) : null}
              {summary.hasActiveDuplicate ? (
                <Link
                  href={`/admin/clients/duplicates?q=${encodeURIComponent(details.duplicateInfo.duplicatesSearchQuery)}`}
                  className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  Возможный дубль
                </Link>
              ) : null}
            </div>
            <p className="text-sm text-zinc-600">
              Создан {formatDateTime(client.createdAt)} · Обновлён{" "}
              {formatDateTime(client.updatedAt)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoRow label="Телефон" value={client.phone ?? "—"} />
          <InfoRow label="Нормализованный телефон" value={client.normalizedPhone ?? "—"} />
          <InfoRow label="Email" value={client.email ?? "—"} />
          <InfoRow label="Источник" value={client.source ?? "—"} />
          <InfoRow label="Дата рождения" value={formatDate(client.birthDate)} />
          <InfoRow label="Пол" value={client.gender ?? "—"} />
          <InfoRow label="Уровень лояльности" value={client.loyaltyLevel ?? "—"} />
          <InfoRow label="Бонусный баланс" value={String(client.bonusBalance)} />
          <InfoRow label="Общая сумма" value={String(client.totalSpent)} />
          <InfoRow label="Последний визит" value={formatDateTime(client.lastVisitAt)} />
          <InfoRow label="Последний контакт" value={formatDateTime(client.lastContactAt)} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Всего заявок" value={summary.totalBookingRequests} />
        <SummaryCard label="Активных заявок" value={summary.activeBookingRequests} />
        <SummaryCard label="Закрытых заявок" value={summary.closedBookingRequests} />
        <SummaryCard label="Всего записей" value={summary.totalAppointments} />
        <SummaryCard
          label="Ближайшая запись"
          value={summary.nextAppointmentAt ? formatDateTime(summary.nextAppointmentAt) : "—"}
        />
        <SummaryCard
          label="Последняя запись"
          value={summary.lastAppointmentAt ? formatDateTime(summary.lastAppointmentAt) : "—"}
        />
        <SummaryCard
          label="Возможные дубли"
          value={summary.hasActiveDuplicate ? "Да" : "Нет"}
        />
        <SummaryCard label="Бонусы" value={summary.bonusBalance} />
      </section>

      <Section title="Теги">
        {client.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {client.tags.map((tag) => (
              <ClientTagBadge key={tag} tag={tag} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Теги не указаны.</p>
        )}
      </Section>

      <Section
        title="История заявок"
        description="Только просмотр. Новые заявки сверху."
      >
        {details.bookingRequests.length === 0 ? (
          <p className="text-sm text-zinc-500">Связанных заявок нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Создана</th>
                  <th className="px-3 py-2 font-medium">Имя</th>
                  <th className="px-3 py-2 font-medium">Телефон</th>
                  <th className="px-3 py-2 font-medium">Тип / источник</th>
                  <th className="px-3 py-2 font-medium">Мастер</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Комментарий</th>
                  <th className="px-3 py-2 font-medium">Обновлена</th>
                </tr>
              </thead>
              <tbody>
                {details.bookingRequests.map((request) => (
                  <tr key={request.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 text-zinc-700">
                      {formatDateTime(request.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-zinc-900">{request.clientName}</td>
                    <td className="px-3 py-2 text-zinc-700">{request.clientPhone}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {REQUEST_TYPE_LABELS[request.type]}
                      <span className="block text-xs text-zinc-500">
                        {REQUEST_SOURCE_LABELS[request.source as keyof typeof REQUEST_SOURCE_LABELS] ??
                          request.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{request.masterName ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {getBookingRequestStatusLabel(request.status)}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-zinc-600">
                      {request.comment?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {formatDateTime(request.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {details.bookingRequestsTruncated ? (
          <p className="mt-3 text-xs text-zinc-500">Показаны последние 20 заявок.</p>
        ) : null}
      </Section>

      <Section
        title="История записей"
        description="Только просмотр. Сортировка по дате записи, новые сверху."
      >
        {details.appointments.length === 0 ? (
          <p className="text-sm text-zinc-500">Связанных записей нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Время</th>
                  <th className="px-3 py-2 font-medium">Мастер</th>
                  <th className="px-3 py-2 font-medium">Услуга</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {details.appointments.map((appointment) => (
                  <tr key={appointment.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 text-zinc-700">
                      {formatDate(appointment.startsAt)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {formatTimeRange(appointment.startsAt, appointment.endsAt)}
                    </td>
                    <td className="px-3 py-2 text-zinc-900">{appointment.masterName}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {appointment.serviceName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {getEditorAppointmentStatusLabel(appointment.status)}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-zinc-600">
                      {[appointment.comment, appointment.importantNote]
                        .filter((value) => value?.trim())
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {details.appointmentsTruncated ? (
          <p className="mt-3 text-xs text-zinc-500">Показаны последние 20 записей.</p>
        ) : null}
      </Section>

      <Section title="Дубли и объединения">
        <div className="space-y-4 text-sm text-zinc-700">
          {details.duplicateInfo.hasActiveDuplicate ? (
            <p>
              Клиент входит в активную группу возможных дублей.{" "}
              <Link
                href={`/admin/clients/duplicates?q=${encodeURIComponent(details.duplicateInfo.duplicatesSearchQuery)}`}
                className="font-medium text-[#1a73e8] hover:underline"
              >
                Открыть разбор дублей
              </Link>
            </p>
          ) : (
            <p>Активных групп дублей для этого клиента нет.</p>
          )}

          {client.mergedIntoClientId ? (
            <div className="rounded border border-violet-100 bg-violet-50 px-3 py-3">
              <p className="font-medium text-violet-900">Объединён в другого клиента</p>
              <ul className="mt-2 space-y-1 text-xs text-violet-800">
                <li>
                  Основной клиент:{" "}
                  <Link
                    href={`/admin/clients/${client.mergedIntoClientId}`}
                    className="font-medium text-[#1a73e8] hover:underline"
                  >
                    {client.mergedIntoClientName ?? client.mergedIntoClientId}
                  </Link>
                </li>
                <li>Дата объединения: {formatDateTime(client.mergedAt)}</li>
                <li>Кто объединил: {client.mergedByUserName ?? "—"}</li>
                {client.mergeNote ? <li>Комментарий: {client.mergeNote}</li> : null}
              </ul>
            </div>
          ) : null}

          {details.mergedClients.length > 0 ? (
            <div>
              <p className="font-medium text-zinc-900">
                В этого клиента объединены другие карточки
              </p>
              <ul className="mt-2 space-y-2">
                {details.mergedClients.map((source) => (
                  <li
                    key={source.id}
                    className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                  >
                    <Link
                      href={`/admin/clients/${source.id}`}
                      className="font-medium text-[#1a73e8] hover:underline"
                    >
                      {source.fullName}
                    </Link>
                    <span className="mt-1 block text-zinc-600">
                      {source.phone ?? "—"} · {source.email ?? "—"} · объединён{" "}
                      {formatDateTime(source.mergedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {details.mergeLogs.length > 0 ? (
            <div>
              <p className="font-medium text-zinc-900">Журнал объединений</p>
              <ul className="mt-2 space-y-2">
                {details.mergeLogs.map((log) => (
                  <li
                    key={log.id}
                    className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                  >
                    <p className="font-medium text-zinc-900">
                      {formatDateTime(log.createdAt)}
                      {log.mergedByUserName ? ` · ${log.mergedByUserName}` : ""}
                    </p>
                    {log.reason ? (
                      <p className="mt-1 text-zinc-600">Причина: {log.reason}</p>
                    ) : null}
                    {log.sourceClients.length > 0 ? (
                      <p className="mt-1 text-zinc-600">
                        Присоединены:{" "}
                        {log.sourceClients.map((source, index) => (
                          <span key={source.id}>
                            {index > 0 ? ", " : ""}
                            <Link
                              href={`/admin/clients/${source.id}`}
                              className="font-medium text-[#1a73e8] hover:underline"
                            >
                              {source.fullName}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Заметки">
        {client.notes?.trim() ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-700">{client.notes}</p>
        ) : (
          <p className="text-sm text-zinc-500">Заметки не указаны.</p>
        )}
      </Section>
    </div>
  );
}
