"use client";

import type { QuickManagerEditorData } from "@/types/schedule-month";
import {
  QuickNotesEditor,
  type QuickNotesEditorConfig,
} from "@/components/schedule/quick-notes-editor";

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

export function QuickManagerEditor({
  data,
  canEdit,
  onClose,
}: {
  data: QuickManagerEditorData;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <QuickNotesEditor
      data={data}
      config={MANAGER_CONFIG}
      canEdit={canEdit}
      onClose={onClose}
    />
  );
}
