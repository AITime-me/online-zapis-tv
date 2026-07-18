"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { getClientStatusLabel } from "@/lib/clients/defaults";
import { getEditorAppointmentStatusLabel } from "@/lib/schedule/editor-field-labels";
import { getBookingRequestStatusLabel } from "@/lib/booking-requests/booking-request-contract";
import { ClientDetailEditableFields } from "@/components/admin/client-detail-editable-fields";
import type { ClientDetailResult } from "@/types/client-detail";
import type { BookingRequestType } from "@prisma/client";

const REQUEST_TYPE_LABELS: Record<BookingRequestType, string> = {
  MANAGER_REQUEST: "Заявка через менеджера",
  CONSULTATION_REQUEST: "Консультация",
  RESCHEDULE_REQUEST: "Перенос записи",
};

const REQUEST_SOURCE_LABELS = {
  ONLINE: "Онлайн",
} as const;

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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

export function ClientDetailView({
  initialDetails,
  canEdit,
}: {
  initialDetails: ClientDetailResult;
  canEdit: boolean;
}) {
  const [details, setDetails] = useState(initialDetails);
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

        <ClientDetailEditableFields
          client={client}
          canEdit={canEdit}
          onClientChange={(patch) =>
            setDetails((current) => ({
              ...current,
              client: { ...current.client, ...patch },
            }))
          }
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Последний визит</p>
            <p className="text-sm text-zinc-900">{formatDateTime(client.lastVisitAt)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Последний контакт</p>
            <p className="text-sm text-zinc-900">{formatDateTime(client.lastContactAt)}</p>
          </div>
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
                  <th className="px-3 py-2 font-medium">Процедура</th>
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
                        {REQUEST_SOURCE_LABELS[
                          request.source as keyof typeof REQUEST_SOURCE_LABELS
                        ] ?? request.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{request.masterName ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {request.serviceNameSnapshot ?? "—"}
                    </td>
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
                      {appointment.comment?.trim() || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
