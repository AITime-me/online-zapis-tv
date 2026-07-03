"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagerNoteType } from "@prisma/client";
import type { ScheduleDayManagerNote } from "@/types/schedule";

export function ManagerNoteEditorForm({
  note,
  canEdit,
  onSaved,
  onDeleted,
  onSaveStatus,
  deleteLabel = "Удалить задачу?",
}: {
  note: ScheduleDayManagerNote;
  canEdit: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
  deleteLabel?: string;
}) {
  const [content, setContent] = useState(note.content);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    setContent(note.content);
  }, [note.content, note.id]);

  const save = useCallback(async () => {
    if (!canEdit) {
      return;
    }

    const trimmed = contentRef.current.trim();
    if (!trimmed) {
      setError("Текст заметки не может быть пустым");
      onSaveStatus("error", "Текст заметки не может быть пустым");
      return;
    }

    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(`/api/manager-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка сохранения");
      }
      onSaveStatus("saved");
      onSaved();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Ошибка сохранения";
      setError(message);
      onSaveStatus("error", message);
    }
  }, [canEdit, note.id, onSaved, onSaveStatus]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void save();
    }, 500);
  }, [save]);

  const handleDelete = async () => {
    if (!canEdit || !confirm(deleteLabel)) {
      return;
    }

    onSaveStatus("saving");
    try {
      const response = await fetch(`/api/manager-notes/${note.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка удаления");
      }
      onSaveStatus("saved");
      onDeleted();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Ошибка удаления";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  if (!canEdit) {
    return (
      <article className="border border-[#e8eaed] bg-[#f8f9fa] px-2 py-1.5 text-xs text-zinc-800">
        {note.content}
      </article>
    );
  }

  return (
    <article className="border border-[#e8eaed] bg-[#f8f9fa] p-2 text-xs">
      <textarea
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          scheduleSave();
        }}
        onBlur={() => void save()}
        rows={2}
        className="w-full resize-y border border-[#dadce0] px-2 py-1 text-xs"
        placeholder="Текст заметки"
      />
      {error ? <p className="mt-1 text-[10px] text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={() => void handleDelete()}
        className="mt-2 text-[10px] text-red-600 hover:underline"
      >
        Удалить
      </button>
    </article>
  );
}

export function NewManagerNoteForm({
  dateKey,
  noteType = "MANAGER",
  onCreated,
  onCancel,
  onSaveStatus,
  formTitle = "Новая задача",
  placeholder = "Например: Лариса 10–19",
}: {
  dateKey: string;
  noteType?: ManagerNoteType;
  onCreated: () => void;
  onCancel: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
  formTitle?: string;
  placeholder?: string;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/manager-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey, content, noteType }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Ошибка создания");
      }
      onSaveStatus("saved");
      onCreated();
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Ошибка создания";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  return (
    <div className="border border-[#dadce0] bg-white p-2 text-xs">
      <p className="mb-2 font-medium">{formTitle}</p>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        className="w-full resize-y border border-[#dadce0] px-2 py-1 text-xs"
        placeholder={placeholder}
        autoFocus
      />
      {error ? <p className="mt-2 text-[10px] text-red-600">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="bg-[#1a73e8] px-2 py-1 text-[10px] text-white"
        >
          Добавить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-[#dadce0] px-2 py-1 text-[10px]"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
