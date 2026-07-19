"use client";

import type { QuickManagerEditorData } from "@/types/schedule-month";
import {
  QuickNotesEditor,
  type QuickNotesEditorConfig,
} from "@/components/schedule/quick-notes-editor";
import { ScheduleBookingRequestCard } from "@/components/schedule/schedule-booking-request-card";

const MANAGER_CONFIG: QuickNotesEditorConfig = {
  noteType: "MANAGER",
  title: "Задачи менеджера",
  addButtonLabel: "+ Задача",
  sectionLabel: "Задачи",
  emptyLabel: "Нет задач",
  newNoteTitle: "Новая задача",
  newNotePlaceholder: "Например: Лариса 10–19",
  deleteLabel: "Удалить задачу?",
};

import type { ScheduleBookingRequestDetailLevel } from "@/components/schedule/schedule-booking-request-card";

export function QuickManagerEditor({
  data,
  canEdit,
  onClose,
  onRequestOpen,
  bookingRequestDetailLevel = "full",
}: {
  data: QuickManagerEditorData;
  canEdit: boolean;
  onClose: () => void;
  onRequestOpen?: (request: QuickManagerEditorData["bookingRequests"][number]) => void;
  bookingRequestDetailLevel?: ScheduleBookingRequestDetailLevel;
}) {
  return (
    <QuickNotesEditor
      data={data}
      config={MANAGER_CONFIG}
      canEdit={canEdit}
      onClose={onClose}
      headerExtra={
        data.bookingRequests.length > 0 ? (
          <div className="border-b border-[#dadce0] px-3 py-2">
            <p className="mb-2 text-xs font-medium text-zinc-700">
              Заявки в этой ячейке
            </p>
            <div className="flex flex-col gap-1">
              {data.bookingRequests.map((request) => (
                <ScheduleBookingRequestCard
                  key={request.id}
                  request={request}
                  variant="month"
                  detailLevel={bookingRequestDetailLevel}
                  onOpen={
                    onRequestOpen
                      ? (selected) => onRequestOpen(selected)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}
