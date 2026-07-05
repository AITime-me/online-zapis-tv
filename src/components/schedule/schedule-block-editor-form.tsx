"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleDayBlock } from "@/types/schedule";
import {
  FULL_DAY_BLOCK_TYPES,
  INTERVAL_BLOCK_TYPES,
} from "@/lib/schedule/labels";
import {
  getEditorBlockTypeLabel,
  getEditorFullDayClosureLabel,
} from "@/lib/schedule/editor-field-labels";
import { toScheduleTimeInput } from "@/lib/schedule/editor-options";
import { EditorField } from "@/components/schedule/editor-field";

type BlockFormState = {
  startTime: string;
  endTime: string;
  blockType: string;
};

function toFormState(block: ScheduleDayBlock): BlockFormState {
  return {
    startTime: block.startsAt
      ? toScheduleTimeInput(block.startsAt, "14:00")
      : "14:00",
    endTime: block.endsAt ? toScheduleTimeInput(block.endsAt, "15:00") : "15:00",
    blockType: block.blockType,
  };
}

export function ScheduleBlockEditorForm({
  block,
  dateKey,
  masterId,
  canEdit,
  onSaved,
  onDeleted,
  onSaveStatus,
}: {
  block: ScheduleDayBlock;
  dateKey: string;
  masterId: string;
  canEdit: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
}) {
  const [form, setForm] = useState<BlockFormState>(() => toFormState(block));
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    setForm(toFormState(block));
  }, [block]);

  const save = useCallback(async () => {
    if (!canEdit || block.isFullDay) {
      return;
    }

    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch(`/api/schedule-blocks/${block.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId,
          dateKey,
          isFullDay: false,
          startTime: formRef.current.startTime,
          endTime: formRef.current.endTime,
          blockType: formRef.current.blockType,
        }),
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
  }, [block.id, block.isFullDay, canEdit, dateKey, masterId, onSaved, onSaveStatus]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void save();
    }, 500);
  }, [save]);

  const handleDelete = async () => {
    if (!canEdit || !confirm("Удалить закрытие?")) {
      return;
    }

    onSaveStatus("saving");
    try {
      const response = await fetch(`/api/schedule-blocks/${block.id}`, {
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

  if (block.isFullDay) {
    return (
      <div className="rounded border border-zinc-300 bg-[#eceff1] px-2 py-2 text-xs">
        <div className="font-semibold uppercase tracking-wide text-zinc-600">
          {block.blockTypeLabel}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="mt-2 text-[10px] text-red-600 hover:underline"
          >
            Снять закрытие дня
          </button>
        ) : null}
      </div>
    );
  }

  if (!canEdit) {
    return (
      <article className="bg-[#f1f3f4] px-2 py-1 text-xs text-zinc-700">
        БЛОК {form.startTime}–{form.endTime} {block.blockTypeLabel}
      </article>
    );
  }

  return (
    <article className="border border-[#e8eaed] bg-[#f1f3f4] p-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <EditorField field="startTime" htmlFor={`block-${block.id}-start`}>
          <input
            id={`block-${block.id}-start`}
            type="time"
            value={form.startTime}
            onChange={(event) => {
              setForm((current) => ({ ...current, startTime: event.target.value }));
              scheduleSave();
            }}
            onBlur={() => void save()}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
        <EditorField field="endTime" htmlFor={`block-${block.id}-end`}>
          <input
            id={`block-${block.id}-end`}
            type="time"
            value={form.endTime}
            onChange={(event) => {
              setForm((current) => ({ ...current, endTime: event.target.value }));
              scheduleSave();
            }}
            onBlur={() => void save()}
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
      </div>

      <EditorField
        field="blockType"
        htmlFor={`block-${block.id}-type`}
        className="mt-2 flex flex-col gap-0.5"
      >
        <select
          id={`block-${block.id}-type`}
          value={form.blockType}
          onChange={(event) => {
            setForm((current) => ({ ...current, blockType: event.target.value }));
            scheduleSave();
          }}
          onBlur={() => void save()}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          {INTERVAL_BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {getEditorBlockTypeLabel(type)}
            </option>
          ))}
        </select>
      </EditorField>

      {error ? <p className="mt-2 text-[10px] text-red-600">{error}</p> : null}

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

export function NewIntervalBlockForm({
  dateKey,
  masterId,
  onCreated,
  onCancel,
  onSaveStatus,
}: {
  dateKey: string;
  masterId: string;
  onCreated: () => void;
  onCancel: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
}) {
  const [form, setForm] = useState({
    startTime: "14:00",
    endTime: "15:00",
    blockType: "BREAK",
  });
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/schedule-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId,
          dateKey,
          isFullDay: false,
          ...form,
        }),
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
    <div className="border border-[#dadce0] bg-[#f8f9fa] p-2 text-xs">
      <p className="mb-2 font-medium">+ Интервал</p>
      <div className="grid grid-cols-2 gap-2">
        <EditorField field="startTime" htmlFor="new-interval-start">
          <input
            id="new-interval-start"
            type="time"
            value={form.startTime}
            onChange={(event) =>
              setForm((current) => ({ ...current, startTime: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
        <EditorField field="endTime" htmlFor="new-interval-end">
          <input
            id="new-interval-end"
            type="time"
            value={form.endTime}
            onChange={(event) =>
              setForm((current) => ({ ...current, endTime: event.target.value }))
            }
            className="border border-[#dadce0] px-1 py-0.5"
          />
        </EditorField>
      </div>
      <EditorField
        field="blockType"
        htmlFor="new-interval-type"
        className="mt-2 flex flex-col gap-0.5"
      >
        <select
          id="new-interval-type"
          value={form.blockType}
          onChange={(event) =>
            setForm((current) => ({ ...current, blockType: event.target.value }))
          }
          className="border border-[#dadce0] px-1 py-0.5"
        >
          {INTERVAL_BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {getEditorBlockTypeLabel(type)}
            </option>
          ))}
        </select>
      </EditorField>
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

export function FullDayBlockForm({
  dateKey,
  masterId,
  onCreated,
  onCancel,
  onSaveStatus,
}: {
  dateKey: string;
  masterId: string;
  onCreated: () => void;
  onCancel: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
}) {
  const [blockType, setBlockType] = useState("DAY_OFF");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/schedule-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterId,
          dateKey,
          isFullDay: true,
          blockType,
        }),
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
    <div className="border border-[#dadce0] bg-[#f8f9fa] p-2 text-xs">
      <p className="mb-2 font-medium">Закрыть день полностью</p>
      <EditorField
        field="closureType"
        htmlFor="new-full-day-type"
        className="flex flex-col gap-0.5"
      >
        <select
          id="new-full-day-type"
          value={blockType}
          onChange={(event) => setBlockType(event.target.value)}
          className="border border-[#dadce0] px-1 py-0.5"
        >
          {FULL_DAY_BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {getEditorFullDayClosureLabel(type)}
            </option>
          ))}
        </select>
      </EditorField>
      {error ? <p className="mt-2 text-[10px] text-red-600">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="bg-zinc-700 px-2 py-1 text-[10px] text-white"
        >
          Закрыть день
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
