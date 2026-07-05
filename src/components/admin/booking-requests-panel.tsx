"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingRequestStatus } from "@prisma/client";
import { getStudioNow, normalizeDate } from "@/lib/datetime/date-layer";
import {
  getBookingRequestStatusLabel,
  getBookingRequestTypeLabel,
  type BookingRequestDto,
} from "@/services/BookingRequestService";

const STATUS_OPTIONS: BookingRequestStatus[] = ["NEW", "CONTACTED", "CLOSED"];

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(normalizeDate(value) ?? getStudioNow());
}

export function BookingRequestsPanel({
  initialRequests,
}: {
  initialRequests: BookingRequestDto[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  const updateStatus = useCallback(
    async (id: string, status: BookingRequestStatus) => {
      setUpdatingId(id);
      setError(null);
      try {
        const response = await fetch("/api/booking/requests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          request?: BookingRequestDto;
          error?: string;
        };
        if (!response.ok || !data.ok || !data.request) {
          throw new Error(data.error ?? "Не удалось обновить статус");
        }
        setRequests((current) =>
          current.map((entry) =>
            entry.id === id ? data.request! : entry,
          ),
        );
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Не удалось обновить статус",
        );
      } finally {
        setUpdatingId(null);
      }
    },
    [],
  );

  if (requests.length === 0) {
    return (
      <div className="rounded border border-[#dadce0] bg-white px-4 py-8 text-center text-sm text-zinc-500">
        Заявок пока нет.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded border border-[#dadce0] bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[#dadce0] bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Имя</th>
              <th className="px-3 py-2 font-medium">Телефон</th>
              <th className="px-3 py-2 font-medium">Мастер</th>
              <th className="px-3 py-2 font-medium">Тип</th>
              <th className="px-3 py-2 font-medium">Комментарий</th>
              <th className="px-3 py-2 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#dadce0]">
            {requests.map((request) => (
              <tr key={request.id}>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatCreatedAt(request.createdAt)}
                </td>
                <td className="px-3 py-2">{request.clientName}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {request.clientPhone}
                </td>
                <td className="px-3 py-2">
                  {request.masterName ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {getBookingRequestTypeLabel(request.type)}
                </td>
                <td className="px-3 py-2 max-w-xs">
                  {request.comment ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={request.status}
                    disabled={updatingId === request.id}
                    onChange={(event) =>
                      void updateStatus(
                        request.id,
                        event.target.value as BookingRequestStatus,
                      )
                    }
                    className="rounded border border-zinc-300 px-2 py-1 text-xs"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {getBookingRequestStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
