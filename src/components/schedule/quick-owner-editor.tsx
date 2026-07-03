"use client";

import type { QuickOwnerEditorData } from "@/types/schedule-month";
import {
  QuickNotesEditor,
  type QuickNotesEditorConfig,
} from "@/components/schedule/quick-notes-editor";

const OWNER_CONFIG: QuickNotesEditorConfig = {
  noteType: "OWNER",
  title: "Светлана, руководитель",
  addButtonLabel: "+ Заметка",
  sectionLabel: "Заметки",
  emptyLabel: "Нет заметок",
  newNoteTitle: "Новая заметка",
  newNotePlaceholder: "Например: В студии с 13:00",
  deleteLabel: "Удалить заметку?",
};

export function QuickOwnerEditor({
  data,
  canEdit,
  onClose,
}: {
  data: QuickOwnerEditorData;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <QuickNotesEditor
      data={data}
      config={OWNER_CONFIG}
      canEdit={canEdit}
      onClose={onClose}
    />
  );
}
