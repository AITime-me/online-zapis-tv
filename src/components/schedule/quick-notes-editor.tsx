"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { ManagerNoteType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { formatDateKeyLabel } from "@/lib/datetime/date-layer";
import type { ScheduleDayManagerNote } from "@/types/schedule";
import {
  ManagerNoteEditorForm,
  NewManagerNoteForm,
} from "@/components/schedule/manager-note-editor-form";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export type QuickNotesEditorData = {
  dateKey: string;
  notes: ScheduleDayManagerNote[];
};

export type QuickNotesEditorConfig = {
  noteType: ManagerNoteType;
  title: string;
  addButtonLabel: string;
  sectionLabel: string;
  emptyLabel: string;
  newNoteTitle: string;
  newNotePlaceholder: string;
  deleteLabel: string;
};

export function QuickNotesEditor({
  data: initialData,
  config,
  canEdit,
  onClose,
  headerExtra,
}: {
  data: QuickNotesEditorData;
  config: QuickNotesEditorConfig;
  canEdit: boolean;
  onClose: () => void;
  headerExtra?: ReactNode;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [showNewNote, setShowNewNote] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refreshNotes = useCallback(async () => {
    const response = await fetch(
      `/api/manager-notes?date=${data.dateKey}&type=${config.noteType}`,
    );
    const payload = await response.json();
    if (response.ok && payload.ok) {
      setData({
        dateKey: payload.dateKey,
        notes: payload.notes,
      });
    }
    router.refresh();
  }, [config.noteType, data.dateKey, router]);

  const handleSaveStatus = (status: SaveStatus, message?: string) => {
    setSaveStatus(status);
    setSaveMessage(message ?? null);
    if (status === "saved") {
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const statusLabel =
    saveStatus === "saving"
      ? "Сохраняю..."
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? `Ошибка${saveMessage ? `: ${saveMessage}` : ""}`
          : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-[#dadce0] bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="quick-notes-editor-title"
      >
        <div className="flex items-start justify-between border-b border-[#dadce0] bg-[#f8f9fa] px-3 py-2">
          <div>
            <h2
              id="quick-notes-editor-title"
              className="text-sm font-semibold text-zinc-900"
            >
              {config.title}
            </h2>
            <p className="text-xs text-zinc-600">{formatDateKeyLabel(data.dateKey)}</p>
            {statusLabel ? (
              <p
                className={`mt-0.5 text-[10px] ${
                  saveStatus === "error"
                    ? "text-red-600"
                    : saveStatus === "saved"
                      ? "text-green-700"
                      : "text-zinc-500"
                }`}
              >
                {statusLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 px-1 text-lg leading-none text-zinc-500 hover:text-zinc-900"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {headerExtra}

        <div className="p-3">
          {canEdit ? (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowNewNote(true)}
                className="border border-[#dadce0] bg-white px-2 py-1 text-[10px] hover:bg-[#f1f3f4]"
              >
                {config.addButtonLabel}
              </button>
            </div>
          ) : null}

          {showNewNote && canEdit ? (
            <div className="mb-3">
              <NewManagerNoteForm
                dateKey={data.dateKey}
                noteType={config.noteType}
                formTitle={config.newNoteTitle}
                placeholder={config.newNotePlaceholder}
                onCreated={async () => {
                  setShowNewNote(false);
                  await refreshNotes();
                }}
                onCancel={() => setShowNewNote(false)}
                onSaveStatus={handleSaveStatus}
              />
            </div>
          ) : null}

          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {config.sectionLabel}
            </h3>
            {data.notes.length === 0 ? (
              <p className="text-[10px] text-zinc-400">{config.emptyLabel}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.notes.map((note) => (
                  <ManagerNoteEditorForm
                    key={note.id}
                    note={note}
                    canEdit={canEdit}
                    deleteLabel={config.deleteLabel}
                    onSaved={() => void refreshNotes()}
                    onDeleted={() => void refreshNotes()}
                    onSaveStatus={handleSaveStatus}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
